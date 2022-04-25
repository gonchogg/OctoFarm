const { findIndex } = require("lodash");
const fetch = require("node-fetch");
const fs = require("fs");
const History = require("../models/History.js");
const ErrorLog = require("../models/ErrorLog.js");
const Logger = require("../handlers/logger.js");
const { SettingsClean } = require("./settings-cleaner.service");
const Spool = require("../models/Filament.js");
const {
  filamentManagerReSync
} = require("../services/octoprint/utils/filament-manager-plugin.utils");
const { ScriptRunner } = require("./local-scripts.service.js");
const MjpegDecoder = require("mjpeg-decoder");
const { downloadImage, downloadFromOctoPrint } = require("../utils/download.util");
const { getHistoryCache } = require("../cache/history.cache");
const { writePoints } = require("./influx-export.service.js");
const { DEFAULT_SPOOL_DENSITY, DEFAULT_SPOOL_RATIO } = require("../constants/cleaner.constants");
const { OctoprintApiClientService } = require("./octoprint/octoprint-api-client.service");
const { getPrinterStoreCache } = require("../cache/printer-store.cache");
const { sleep } = require("../utils/promise.utils");

const logger = new Logger("OctoFarm-HistoryCollection");

const routeBase = "../images/historyCollection";
const PATHS = {
  base: routeBase,
  thumbnails: routeBase + "/thumbs",
  snapshots: routeBase + "/snapshots",
  timelapses: routeBase + "/timelapses"
};

/**
 * Make a specific historyCollection folder if not created yet
 */
function ensureFolderExists(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
}

/**
 * Make the historyCollection root folder if not created yet
 */
function ensureBaseFolderExists() {
  ensureFolderExists(PATHS.base);
}

class HistoryCollection {
  static async resyncFilament(printer, octoPrintApiClient) {
    const returnSpools = [];
    for (const element of printer.selectedFilament) {
      if (element !== null) {
        const filamentID = element.spools.fmID;
        if (!filamentID) {
          logger.error(
            `Could not query OctoPrint FilamentManager for filament. FilamentID '${filamentID}' not found.`,
            element.spools
          );
        }
        const response = await octoPrintApiClient.getPluginFilamentManagerFilament(
          printer,
          filamentID
        );

        logger.info(`${printer.printerURL}: spools fetched. Status: ${response.status}`);
        const sp = await response.json();

        const spoolID = element._id;
        const spoolEntity = await Spool.findById(spoolID);
        if (!spoolEntity) {
          logger.error(
            `Spool database entity by ID '${spoolID}' not found. Cant update filament.`,
            element
          );
          const profileID = JSON.stringify(spoolEntity.spools.profile);
          spoolEntity.spools = {
            name: sp.spool.name,
            profile: profileID,
            price: sp.spool.cost,
            weight: sp.spool.weight,
            used: sp.spool.used,
            tempOffset: sp.spool.temp_offset,
            fmID: sp.spool.id
          };
          logger.info(`${printer.printerURL}: updating... spool status ${spoolEntity.spools}`);
          spoolEntity.markModified("spools");
          await spoolEntity.save();
          returnSpools.push(spoolEntity);
        }
        return;
      }
    }

    const reSync = await filamentManagerReSync();
    // Return success
    logger.info(reSync);
    return returnSpools;
  }

  static async grabThumbnail(url, thumbnail, id, printer) {
    if (!url && !thumbnail) {
      logger.error("Unable to download thumbnail! No URL or thumbnail provided", {
        url,
        thumbnail
      });
      return "";
    }
    const thumbParts = thumbnail.split("/");
    const result = thumbParts[thumbParts.length - 1];
    const splitAgain = result.split("?");
    const filePath = `${PATHS.thumbnails}/${id}-${splitAgain[0]}`;

    ensureBaseFolderExists();
    ensureFolderExists(PATHS.thumbnails);

    await downloadImage(url, filePath, printer.apikey, () => {
      logger.info("Thumbnail downloaded from: ", { url });
      logger.info("Thumbnail saved as: ", { filePath });
    });

    return filePath;
  }

  static async snapPictureOfPrinter(url, id, fileDisplay) {
    if (!url && url === "") {
      logger.error("Unable to snap picture from camera, url doesn't exist!", {
        url
      });
      return "";
    }
    ensureBaseFolderExists();
    ensureFolderExists(PATHS.snapshots);
    const decoder = MjpegDecoder.decoderForSnapshot(url);
    const frame = await decoder.takeSnapshot();
    const filePath = `${PATHS.snapshots}/${id}-${fileDisplay}.jpg`;
    await fs.writeFileSync(filePath, frame);
    logger.info("Snapshot downloaded as: ", url);
    logger.info("Snapshot saved as: ", filePath);
    return filePath;
  }

  /**
   * @param payload
   * @param serverSettings
   * @param files
   * @param id
   * @param event
   * @param printer
   * @returns {Promise<null>}
   */
  static async thumbnailCheck(payload, files, id, printer) {
    try {
      let runCapture = async () => {
        // grab Thumbnail if available.
        const currentFileIndex = findIndex(files, function (o) {
          return o.name === payload.name;
        });
        let base64Thumbnail = null;
        if (currentFileIndex > -1) {
          if (
            typeof files[currentFileIndex] !== "undefined" &&
            files[currentFileIndex].thumbnail !== null
          ) {
            base64Thumbnail = await HistoryCollection.grabThumbnail(
              `${printer.printerURL}/${files[currentFileIndex].thumbnail}`,
              files[currentFileIndex].thumbnail,
              id,
              printer
            );
          }
        }
        return base64Thumbnail;
      };

      return runCapture();
    } catch (e) {
      logger.error("Couldn't capture thumbnail as requested!", e);
    }
  }

  static async snapshotCheck(printer, id, payload) {
    // Use default settings if not present
    try {
      return HistoryCollection.snapPictureOfPrinter(printer.camURL, id, payload.name);
    } catch (e) {
      logger.error("Couldn't capture webcam snapshot as requested!", e);
    }
  }

  static async timelapseCheck(printer, fileName, printTime, id, octoPrintApiClient) {
    if (printTime <= 10) {
      logger.warning("Print time too short, skipping timelapse grab...", { printTime });
      return "";
    }

    const timeLapseCall = await octoPrintApiClient.getTimelapses(true);

    if (!timeLapseCall.ok) {
      logger.error("Time lapse call failed to contact OctoPrint... skipping timelapse grab...", {
        timeLapseCall
      });
      return "";
    }

    logger.info("Checking for timelapse...", fileName);

    const timelapseResponse = await timeLapseCall.json();

    logger.info("Timelapse call: ", timelapseResponse);

    //is it unrendered?
    let cleanFileName = JSON.parse(JSON.stringify(fileName));
    if (fileName.includes(".gcode")) {
      cleanFileName = cleanFileName.replace(".gcode", "");
    }

    const unrenderedTimelapseIndex = timelapseResponse.unrendered.findIndex((o) =>
      o.name.includes(cleanFileName)
    );
    //if unrendered check timelapse again...
    logger.debug("Unrendered Index: ", {
      unrenderedTimelapseIndex,
      unrenderedList: timelapseResponse.unrendered
    });
    if (unrenderedTimelapseIndex > -1) {
      logger.warning("Timelapse not rendered yet... re-checking... in 5000ms", {
        unrenderedTimelapseIndex
      });
      await sleep(10000);
      await this.timelapseCheck(printer, fileName, printTime, id, octoPrintApiClient);
    }

    await sleep(10000);
    
    const lastTimelapseIndex = timelapseResponse.files.findIndex((o) =>
      o.name.includes(cleanFileName)
    );
    logger.debug("rendered Index: ", {
      lastTimelapseIndex,
      renderedList: timelapseResponse.files
    });
    if (lastTimelapseIndex > -1) {
      return HistoryCollection.grabTimeLapse(
        timelapseResponse.files[lastTimelapseIndex].name,
        printer.printerURL + timelapseResponse.files[lastTimelapseIndex].url,
        id,
        printer
      );
    }

    logger.error("Unable to determine correct timelapse file to download... skipped! ", {
      timelapseFiles: timelapseResponse.files
    });

    return "";
  }

  /**
   * Grabs the timelapse by downloading it from OctoPrint's API
   * @param fileName
   * @param url
   * @param id
   * @param printer
   * @returns {Promise<string>}
   */
  static async grabTimeLapse(fileName, url, id, printer) {
    ensureBaseFolderExists();
    ensureFolderExists(PATHS.timelapses);

    const filePath = `${PATHS.timelapses}/${id}-${fileName}`;

    await downloadFromOctoPrint(url, filePath, printer.apikey, async function () {
      const serverSettingsCache = SettingsClean.returnSystemSettings();
      if (serverSettingsCache?.history?.timelapse?.deleteAfter) {
        await sleep(30000);
        logger.info("Deleting time lapse from OctoPrint...", { url, filePath });
        await HistoryCollection.deleteTimeLapse(printer, fileName);
        logger.info("Deleted timelapse from OctoPrint", { fileName });
      }
    });

    logger.info("Downloaded timelapse from: ", { url });
    logger.info("Saved timelapse to: ", { filePath });

    const historyRecord = await History.findById(id);

    historyRecord.printHistory.timelapse = filePath;

    await historyRecord.save().then(async () => {
      logger.info("Successfully updated history record with timelapse url... re-running cache...");
      await getHistoryCache().initCache();
    });

    return filePath;
  }

  static async deleteTimeLapse(printer, fileName) {
    return fetch(`${printer.printerURL}/api/timelapse/${fileName}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": printer.apikey
      }
    });
  }

  static async objectCleanforInflux(obj) {
    for (var propName in obj) {
      if (obj[propName] === null) {
        delete obj[propName];
      }
    }
  }

  static async updateInfluxDB(historyID, measurement, printer) {
    try {
      let historyArchive = getHistoryCache().historyClean;
      let currentArchive = findIndex(historyArchive, function (o) {
        return JSON.stringify(o._id) === JSON.stringify(historyID);
      });
      if (currentArchive <= -1) {
        return;
      }
      let workingHistory = historyArchive[currentArchive];
      let currentState = " ";
      if (workingHistory.state.includes("Success")) {
        currentState = "Success";
      } else if (workingHistory.state.includes("Cancelled")) {
        currentState = "Cancelled";
      } else if (workingHistory.state.includes("Failure")) {
        currentState = "Failure";
      }
      let group = " ";
      if (printer.group === "") {
        group = " ";
      } else {
        group = printer.group;
      }
      const tags = {
        printer_name: workingHistory.printer,
        group: group,
        url: printer.printerURL,
        history_state: currentState,
        file_name: workingHistory.file.name
      };
      let printerData = {
        id: String(workingHistory._id),
        index: parseInt(workingHistory.index),
        state: currentState,
        printer_name: workingHistory.printer,
        start_date: new Date(workingHistory.startDate),
        end_date: new Date(workingHistory.endDate),
        print_time: parseInt(workingHistory.printTime),
        file_name: workingHistory.file.name,
        file_upload_date: parseFloat(workingHistory.file.uploadDate),
        file_path: workingHistory.file.path,
        file_size: parseInt(workingHistory.file.size),

        notes: workingHistory.notes,
        job_estimated_print_time: parseFloat(workingHistory.job.estimatedPrintTime),
        job_actual_print_time: parseFloat(workingHistory.job.actualPrintTime),

        cost_printer: parseFloat(workingHistory.printerCost),
        cost_spool: parseFloat(workingHistory.spoolCost),
        cost_total: parseFloat(workingHistory.totalCost),
        cost_per_hour: parseFloat(workingHistory.costPerHour),
        total_volume: parseFloat(workingHistory.totalVolume),
        total_length: parseFloat(workingHistory.totalLength),
        total_weight: parseFloat(workingHistory.totalWeight)
      };
      let averagePrintTime = parseFloat(workingHistory.file.averagePrintTime);
      if (!isNaN(averagePrintTime)) {
        printerData["file_average_print_time"] = averagePrintTime;
      }
      let lastPrintTime = parseFloat(workingHistory.file.lastPrintTime);
      if (!isNaN(averagePrintTime)) {
        printerData["file_last_print_time"] = lastPrintTime;
      }
      if (typeof workingHistory.resend !== "undefined") {
        printerData["job_resends"] = `${workingHistory.resend.count} / ${
          workingHistory.resend.transmitted / 1000
        }K (${workingHistory.resend.ratio.toFixed(0)})`;
      }
      writePoints(tags, "HistoryInformation", printerData);
    } catch (e) {
      logger.error(e);
    }
  }

  static async updateFilamentInfluxDB(selectedFilament, history, printer) {
    for (let i = 0; i < selectedFilament.length; i++) {
      if (selectedFilament[i] !== null) {
        let currentState = " ";
        let group = " ";
        if (printer.group === "") {
          group = " ";
        } else {
          group = printer.group;
        }
        if (history.success) {
          currentState = "Success";
        } else {
          if (history.reason === "cancelled") {
            currentState = "Cancelled";
          } else {
            currentState = "Failure";
          }
        }

        const tags = {
          name: selectedFilament[i].spools.name,
          printer_name: history.printerName,
          group: group,
          url: printer.printerURL,
          history_state: currentState,
          file_name: history.fileName
        };

        let filamentData = {
          name: selectedFilament[i].spools.name,
          price: parseFloat(selectedFilament[i].spools.price),
          weight: parseFloat(selectedFilament[i].spools.weight),
          used_difference: parseFloat(used),
          used_spool: parseFloat(selectedFilament[i].spools.used),
          temp_offset: parseFloat(selectedFilament[i].spools.tempOffset),
          spool_manufacturer: selectedFilament[i].spools.profile.manufacturer,
          spool_material: selectedFilament[i].spools.profile.material,
          spool_density: parseFloat(selectedFilament[i].spools.profile.density),
          spool_diameter: parseFloat(selectedFilament[i].spools.profile.diameter)
        };

        writePoints(tags, "SpoolInformation", filamentData);
      }
    }
  }

  static generateStartEndDates(payload) {
    const today = new Date();
    const printTime = new Date(payload.time * 1000);
    let startDate = today.getTime() - printTime.getTime();
    startDate = new Date(startDate);

    const endDate = new Date();
    return { startDate, endDate };
  }

  // repeated... could have imported I suppose...
  static generateWeightOfJobForASpool(length, filament, completionRatio) {
    if (!length) {
      return length === 0 ? 0 : length;
    }

    let density = DEFAULT_SPOOL_DENSITY;
    let radius = DEFAULT_SPOOL_RATIO;
    if (!!filament?.spools?.profile) {
      radius = parseFloat(filament.spools.profile.diameter) / 2;
      density = parseFloat(filament.spools.profile.density);
    }

    const volume = length * Math.PI * radius * radius; // Repeated 4x across server
    return (completionRatio * volume * density).toFixed(2);
  }
  static async downDateWeight(payload, job, filament, success) {
    let printTime = 0;
    if (job?.lastPrintTime) {
      // Last print time available, use this as it's more accurate
      printTime = job.lastPrintTime;
    } else {
      printTime = job.estimatedPrintTime;
    }

    let printPercentage = 0;

    if (!success) {
      printPercentage = (payload.time / printTime) * 100;
    }

    let completionRatio = success ? 1.0 : printPercentage / 100;

    for (let s = 0; s < filament.length; s++) {
      const currentSpool = filament[s];
      if (job?.filament["tool" + s]?.length) {
        const currentGram = this.generateWeightOfJobForASpool(
          job.filament["tool" + s].length / 1000,
          currentSpool,
          completionRatio
        );
        await Spool.findById(currentSpool._id).then((spool) => {
          const currentUsed = parseFloat(spool.spools.used);
          spool.spools.used = (currentUsed + parseFloat(currentGram)).toFixed(2);
          spool.markModified("spools.used");
          spool.save();
        });
      }
    }
  }

  static async checkForAdditionalSuccessProperties(
    payload,
    job,
    currentFilament,
    state,
    printer,
    saveHistory,
    printerAPIConnector,
    files
  ) {
    const serverSettingsCache = SettingsClean.returnSystemSettings();

    if (serverSettingsCache.filament.downDateSuccess && !serverSettingsCache.filamentManager) {
      // Capture success amount
      await this.downDateWeight(payload, job, currentFilament, state);
    }

    if (serverSettingsCache.history.thumbnails.onComplete) {
      saveHistory.printHistory.thumbnail = await HistoryCollection.thumbnailCheck(
        payload,
        files,
        saveHistory._id,
        printer
      );
    }

    if (serverSettingsCache.history.snapshot.onComplete) {
      saveHistory.printHistory.snapshot = await HistoryCollection.snapshotCheck(
        printer,
        saveHistory._id,
        payload
      );
    }
    // This should use the websocket events..
    if (serverSettingsCache.history.timelapse.onComplete) {
      await HistoryCollection.timelapseCheck(
        printer,
        payload.name,
        payload.time,
        saveHistory._id,
        printerAPIConnector
      );
    }
  }

  static async checkForAdditionalFailureProperties(
    payload,
    job,
    currentFilament,
    state,
    printer,
    saveHistory,
    printerAPIConnector,
    files
  ) {
    const serverSettingsCache = SettingsClean.returnSystemSettings();
    if (serverSettingsCache.history.thumbnails.onFailure) {
      saveHistory.printHistory.thumbnail = await HistoryCollection.thumbnailCheck(
        payload,
        files,
        saveHistory._id,
        printer
      );
    }
    if (serverSettingsCache.history.snapshot.onFailure) {
      saveHistory.printHistory.snapshot = await HistoryCollection.snapshotCheck(
        printer,
        saveHistory._id,
        payload
      );
    }
    if (serverSettingsCache.history.timelapse.onFailure) {
      await HistoryCollection.timelapseCheck(
        printer,
        payload.name,
        payload.time,
        saveHistory._id,
        printerAPIConnector
      );
    }
    if (serverSettingsCache.filament.downDateFailed && !serverSettingsCache.filamentManager) {
      // No point even trying to down date failed without these...
      if (!job?.estimatedPrintTime && !job?.lastPrintTime) {
        logger.error(
          "Unable to downdate failed jobs spool, no estimatedPrintTime or lastPrintTime",
          {
            job
          }
        );
        return;
      }
      // Capture failed amount
      await this.downDateWeight(payload, job, currentFilament, state);
    }
  }

  static async capturePrint(payload, printer, job, files, resends, state) {
    try {
      logger.warning(`${state ? "Completed" : "Failed"} Print triggered - ${printer.printerURL}`);
      const serverSettingsCache = SettingsClean.returnSystemSettings();

      const printerAPIConnector = new OctoprintApiClientService(
        printer.printerURL,
        printer.apikey,
        printer.timeout
      );

      const { startDate, endDate } = this.generateStartEndDates(payload);

      //If we're using the filament manager plugin... we need to grab the latest spool values to be saved from it.
      if (serverSettingsCache.filamentManager && Array.isArray(printer.selectedFilament)) {
        printer.selectedFilament = await HistoryCollection.resyncFilament(
          printer,
          printerAPIConnector
        );
        logger.info("Grabbed latest filament values", printer.selectedFilament);
      }

      //If we're not using filament manager plugin... we need to check if the user has enabled automated spool updating.
      const printHistory = {
        printerName: printer.printerName,
        printerID: printer._id,
        printerGroup: printer.group,
        costSettings: printer.costSettings,
        success: state,
        reason: payload?.reason,
        fileName: payload.name,
        filePath: payload.path,
        startDate,
        endDate,
        printTime: Math.round(payload.time),
        filamentSelection: printer.selectedFilament,
        job,
        notes: "",
        snapshot: "",
        timelapse: "",
        thumbnail: "",
        resends: resends
      };
      // Create our history object
      const saveHistory = new History({
        printHistory
      });

      // Save initial history
      if (state) {
        await this.checkForAdditionalSuccessProperties(
          payload,
          job,
          printer.selectedFilament,
          state,
          printer,
          saveHistory,
          printerAPIConnector,
          files
        );
      }

      if (!state) {
        await this.checkForAdditionalFailureProperties(
          payload,
          job,
          printer.selectedFilament,
          state,
          printer,
          saveHistory,
          printerAPIConnector,
          files
        );
      }

      // await this.updateFilamentInfluxDB(
      //   printer.selectedFilament,
      //   printHistory,
      //   printer.selectedFilament,
      //   printer
      // );

      //await this.updateInfluxDB(saveHistory._id, "historyInformation", printer);
      await saveHistory
        .save()
        .then(async (res) => {
          logger.info("Successfully captured print!", res);
        })
        .catch((e) => {
          logger.error("Failed to capture print!", e.toString());
        });
      if (!state) {
        ScriptRunner.check(
          getPrinterStoreCache().getPrinter(printer._id),
          "failed",
          saveHistory._id
        )
          .then((resScript) => {
            logger.info("Successfully checked failed script", resScript);
          })
          .catch((e) => {
            logger.error("Failed to check cancelled script", e);
          });
      }
      if (state) {
        ScriptRunner.check(getPrinterStoreCache().getPrinter(printer._id), "done", saveHistory._id)
          .then((resScript) => {
            logger.info("Successfully print finished script", resScript);
          })
          .catch((e) => {
            logger.error("Failed to check print finished script", e);
          });
      }
      setTimeout(async () => {
        // Re-generate history cache...
        await getHistoryCache().initCache();
      }, 5000);
    } catch (e) {
      console.error(e);
      logger.error("Failed to generate history data!", e.toString());
    }
  }

  static async errorLog(payload, printer, job) {
    try {
      let name = null;
      if (typeof printer.settingsAppearance !== "undefined") {
        if (printer.settingsAppearance.name === "" || printer.settingsAppearance.name === null) {
          name = printer.printerURL;
        } else {
          name = printer.settingsAppearance.name;
        }
      } else {
        name = printer.printerURL;
      }
      logger.info("Error Log Collection Triggered", payload + printer.printerURL);
      const today = new Date();
      const printTime = new Date(payload.time * 1000);
      let startDate = today.getTime() - printTime.getTime();
      startDate = new Date(startDate);

      const endDate = new Date();

      const errorLog = {
        printerIndex: printer.index,
        printerID: printer._id,
        costSettings: printer.costSettings,
        printerName: name,
        success: false,
        reason: payload.error,
        startDate,
        endDate,
        printTime: Math.round(payload.time),
        job: job,
        notes: ""
      };
      const saveError = new ErrorLog({
        errorLog
      });
      await saveError
        .save()
        .then((res) => {
          logger.info("Successfully saved error log!", res);
        })
        .catch((e) => {
          logger.error("Failed to save error log!", e.toString());
        });
      await getHistoryCache().initCache();
      await ScriptRunner.check(printer, "error", saveError._id);
      logger.info("Error captured ", payload + printer.printerURL);
    } catch (e) {
      logger.error(e, `Failed to capture ErrorLog for ${printer.printerURL}`);
    }
  }
}

module.exports = {
  HistoryCollection
};

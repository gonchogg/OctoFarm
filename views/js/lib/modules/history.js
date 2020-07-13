import OctoFarmClient from "../octofarm.js";
import Calc from "../functions/calc.js";
import UI from "../functions/ui.js";
import { returnDropDown } from "./filamentGrab.js";

// Setup history listeners
document.getElementById("historyTable").addEventListener("click", (e) => {
  // Remove from UI
  e.preventDefault();
  History.delete(e);
});
document.getElementById("historyTable").addEventListener("click", (e) => {
  // Remove from UI
  e.preventDefault();
  History.edit(e);
});
let historyList = [];
$("#historyModal").on("hidden.bs.modal", function (e) {
  document.getElementById("historySaveBtn").remove();
  document.getElementById("historyUpdateCostBtn").remove();
});

export default class History {
  static async get() {
    // let numOr0 = n => isNaN(n) ? 0 : parseFloat(n)
    const newHistory = await OctoFarmClient.get("history/get");
    historyList = await newHistory.json();
    jplist.init({
      storage: "localStorage", // 'localStorage', 'sessionStorage' or 'cookies'
      storageName: "history-sorting", // the same storage name can be used to share storage between multiple pages
    });
    document.getElementById("loading").style.display = "none";
    document.getElementById("wrapper").classList.remove("d-none");
    document.getElementById("historyToolbar").classList.remove("d-none");
  }

  static async edit(e) {
    function SelectHasValue(select, value) {
      const obj = document.getElementById(select);
      if (obj !== null) {
        return obj.innerHTML.indexOf(`value="${value}"`) > -1;
      }
      return false;
    }
    if (e.target.classList.value.includes("historyEdit")) {
      document.getElementById("historySave").insertAdjacentHTML(
        "afterbegin",
        `
      <button id="historyUpdateCostBtn" type="button" class="btn btn-warning" data-dismiss="modal">
        Update Cost
      </button>
      <button id="historySaveBtn" type="button" class="btn btn-success" data-dismiss="modal">
        Save Changes
      </button>
    `
      );
      document
        .getElementById("historySaveBtn")
        .addEventListener("click", (f) => {
          History.save(e.target.id);
        });
      document
        .getElementById("historyUpdateCostBtn")
        .addEventListener("click", (f) => {
          History.updateCost(e.target.id);
        });
      // Grab elements
      const printerName = document.getElementById("printerName");
      const fileName = document.getElementById("fileName");
      const status = document.getElementById("printStatus");
      const printerCost = document.getElementById("printerCost");
      const actualPrintTime = document.getElementById("printerTime");
      const printTimeAccuracy = document.getElementById("printTimeAccuracy");

      const startDate = document.getElementById("startDate");
      const printTime = document.getElementById("printTime");
      const endDate = document.getElementById("endDate");

      const notes = document.getElementById("notes");

      const uploadDate = document.getElementById("dateUploaded");
      const path = document.getElementById("path");
      const size = document.getElementById("size");

      const estimatedPrintTime = document.getElementById("estimatedPrintTime");
      const averagePrintTime = document.getElementById("averagePrintTime");
      const lastPrintTime = document.getElementById("lastPrintTime");
      const viewTable = document.getElementById("viewTable");
      const jobCosting = document.getElementById("jobCosting");

      viewTable.innerHTML = "";
      printerName.innerHTML = " - ";
      fileName.innerHTML = " - ";
      status.innerHTML = " - ";
      printerCost.placeholder = " - ";
      actualPrintTime.placeholder = " - ";
      printTimeAccuracy.placeholder = " - ";
      startDate.innerHTML = " - ";
      printTime.innerHTML = " - ";
      endDate.innerHTML = " - ";
      notes.placeholder = "";
      uploadDate.placeholder = " - ";
      path.value = " - ";
      size.value = " - ";
      estimatedPrintTime.placeholder = " - ";
      averagePrintTime.placeholder = " - ";
      lastPrintTime.placeholder = " - ";
      jobCosting.placeholder = " - ";
      const thumbnail = document.getElementById("history-thumbnail");
      thumbnail.innerHTML = "";
      const index = _.findIndex(historyList.history, function (o) {
        return o._id == e.target.id;
      });
      const current = historyList.history[index];
      printerName.innerHTML = current.printer;
      fileName.innerHTML = current.file.name;
      if (
        typeof current.thumbnail !== "undefined" &&
        current.thumbnail != null
      ) {
        thumbnail.innerHTML = `<center><img src="http://localhost:4000/${current.thumbnail}" class="historyImage mb-2"></center>`;
      }
      startDate.innerHTML = `<b>Started</b><hr>${current.startDate.replace(
        " - ",
        "<br>"
      )}`;
      printTime.innerHTML = `<b>Duration</b><hr>${Calc.generateTime(
        current.printTime
      )}`;
      endDate.innerHTML = `<b>Finished</b><hr>${current.endDate.replace(
        " - ",
        "<br>"
      )}`;
      printerCost.value = current.printerCost;
      notes.value = current.notes;
      actualPrintTime.value = Calc.generateTime(current.printTime);
      status.innerHTML = `<b>Status</b><hr>${current.state}`;
      if (typeof current.job !== "undefined" && current.job !== null) {
        estimatedPrintTime.value = Calc.generateTime(
          current.job.estimatedPrintTime
        );
        printTimeAccuracy.value = `${
          current.job.printTimeAccuracy.toFixed(0) / 100
        }%`;
      }
      jobCosting.value = current.totalCost;
      let upDate = new Date(current.file.uploadDate * 1000);
      upDate = `${upDate.toLocaleDateString()} ${upDate.toLocaleTimeString()}`;
      uploadDate.value = upDate;
      path.value = current.file.path;
      size.value = Calc.bytes(current.file.size);
      averagePrintTime.value = Calc.generateTime(current.file.averagePrintTime);
      lastPrintTime.value = Calc.generateTime(current.file.lastPrintTime);
      const toolsArray = [];
      current.spools.forEach((spool) => {
        const sp = Object.keys(spool)[0];
        toolsArray.push(sp);
        viewTable.insertAdjacentHTML(
          "beforeend",
          `
          <tr>
            <td>
              <b>${spool[sp].toolName}</b>
              </td>
              <td>
              <div class="input-group mb-3">
                  <select id="filament-${sp}" class="custom-select">
                  </select>
                  </div>
              </td>
              <td>
              ${spool[sp].volume.toFixed(2)}m3
              </td>
              <td>
              ${spool[sp].length.toFixed(2)}m
              </td>
              <td>
                 ${spool[sp].weight.toFixed(2)}g
              </td>
              <td>
                 ${spool[sp].cost}
              </td>
              </tr>
          </tr>
        `
        );
      });
      for (let i = 0; i < toolsArray.length; i++) {
        const currentToolDropDown = document.getElementById(
          `filament-${toolsArray[i]}`
        );
        const filamentList = await returnDropDown();
        filamentList.forEach((list) => {
          currentToolDropDown.insertAdjacentHTML("beforeend", list);
        });
        if (current.spools[i][toolsArray[i]].spoolId !== null) {
          if (
            SelectHasValue(
              currentToolDropDown.id,
              current.spools[i][toolsArray[i]].spoolId
            )
          ) {
            currentToolDropDown.value =
              current.spools[i][toolsArray[i]].spoolId;
          } else {
            currentToolDropDown.insertAdjacentHTML(
              "afterbegin",
              `
              <option value="${current.spools[i][toolsArray[i]].spoolId}">${
                current.spools[i][toolsArray[i]].spoolName
              }</option>
          `
            );
            currentToolDropDown.value =
              current.spools[i][toolsArray[i]].spoolId;
          }
        } else {
          currentToolDropDown.value = 0;
        }
      }

      viewTable.insertAdjacentHTML(
        "beforeend",
        `
        <tr style="background-color:#303030;">
        <td>
        Totals
        </td>
        <td>

        </td>
        <td>
        ${current.totalVolume.toFixed(2)}m3
        </td>
        <td>
        ${(current.totalLength / 1000).toFixed(2)}m
        </td>
        <td>
        ${current.totalWeight.toFixed(2)}g
        </td>
        <td>
        ${current.spoolCost}
        </td>
        </tr>
      `
      );
    }
  }

  static async updateCost(id) {
    const update = {
      id,
    };
    let post = await OctoFarmClient.post("history/updateCostMatch", update);
    post = await post.json();
    if (post.status === 200) {
      UI.createAlert(
        "success",
        "Successfully added your printers cost to history.",
        3000,
        "clicked"
      );
      document.getElementById(
        `printerCost-${id}`
      ).innerHTML = Calc.returnPrintCost(post.costSettings, post.printTime);
    } else {
      UI.createAlert(
        "warning",
        "Printer no longer exists in database, default cost applied.",
        3000,
        "clicked"
      );
      document.getElementById(
        `printerCost-${id}`
      ).innerHTML = Calc.returnPrintCost(post.costSettings, post.printTime);
    }
  }

  static async save(id) {
    const filamentDrops = document.querySelectorAll("[id^='filament-tool']");
    const filamentID = [];
    filamentDrops.forEach((drop) => {
      filamentID.push(drop.value);
    });

    const update = {
      id,
      note: document.getElementById("notes").value,
      filamentId: filamentID,
    };

    const post = await OctoFarmClient.post("history/update", update);

    if (post.status === 200) {
      UI.createAlert(
        "success",
        "Successfully updated your history entry...",
        3000,
        "clicked"
      );
      document.getElementById(`note-${id}`).innerHTML = update.note;
      document.getElementById(`spool-${id}`).innerHTML = update.filamentId;
    }
  }

  static async delete(e) {
    if (e.target.classList.value.includes("historyDelete")) {
      bootbox.confirm({
        message:
          "Are you sure you'd like to delete this entry? this is not reversible.",
        buttons: {
          confirm: {
            label: "Yes",
            className: "btn-success",
          },
          cancel: {
            label: "No",
            className: "btn-danger",
          },
        },
        async callback(result) {
          const histID = {
            id: e.target.id,
          };
          const post = await OctoFarmClient.post("history/delete", histID);
          if (post.status === 200) {
            jplist.resetContent(function () {
              // remove element with id = el1
              e.target.parentElement.parentElement.parentElement.remove();
            });
            UI.createAlert(
              "success",
              "Your history entry has been deleted...",
              3000,
              "clicked"
            );
          } else {
            UI.createAlert(
              "error",
              "Hmmmm seems we couldn't contact the server to delete... is it online?",
              3000,
              "clicked"
            );
          }
        },
      });
    }
  }

  static updateTotals(filtered) {
    const times = [];
    const cost = [];
    const printerCost = [];
    const statesCancelled = [];
    const statesFailed = [];
    const statesSuccess = [];
    const totalUsageGrams = [];
    const totalUsageMeter = [];
    filtered.forEach((row) => {
      times.push(parseInt(row.getElementsByClassName("time")[0].innerText));
      if (
        !isNaN(
          parseFloat(row.getElementsByClassName("filamentCost")[0].innerText)
        )
      ) {
        cost.push(
          parseFloat(row.getElementsByClassName("filamentCost")[0].innerText)
        );
      }
      if (
        !isNaN(
          parseFloat(row.getElementsByClassName("printerCost")[0].innerText)
        )
      ) {
        printerCost.push(
          parseFloat(row.getElementsByClassName("printerCost")[0].innerText)
        );
      }
      if (
        !isNaN(
          parseFloat(row.getElementsByClassName("totalUsageGrams")[0].innerText)
        )
      ) {
        totalUsageGrams.push(
          parseFloat(row.getElementsByClassName("totalUsageGrams")[0].innerText)
        );
      }
      if (
        !isNaN(
          parseFloat(row.getElementsByClassName("totalUsageMeter")[0].innerText)
        )
      ) {
        totalUsageMeter.push(
          parseFloat(row.getElementsByClassName("totalUsageMeter")[0].innerText)
        );
      }
      const stateText = row.getElementsByClassName("state")[0].innerText.trim();
      if (stateText === "Cancelled") {
        statesCancelled.push(stateText);
      }
      if (stateText === "Failure") {
        statesFailed.push(stateText);
      }
      if (stateText === "Success") {
        statesSuccess.push(stateText);
      }
    });
    const total =
      statesCancelled.length + statesFailed.length + statesSuccess.length;
    const cancelledPercent = (statesCancelled.length / total) * 100;
    const failurePercent = (statesFailed.length / total) * 100;
    const successPercent = (statesSuccess.length / total) * 100;
    const failure = document.getElementById("totalFailurePercent");
    failure.style.width = `${failurePercent.toFixed(2)}%`;
    failure.innerHTML = `${failurePercent.toFixed(2)}%`;
    const success = document.getElementById("totalSuccessPercent");
    success.style.width = `${successPercent.toFixed(2)}%`;
    success.innerHTML = `${successPercent.toFixed(2)}%`;
    const cancelled = document.getElementById("totalCancelledPercent");
    cancelled.style.width = `${cancelledPercent.toFixed(2)}%`;
    cancelled.innerHTML = `${cancelledPercent.toFixed(2)}%`;
    document.getElementById("totalCost").innerHTML = cost
      .reduce((a, b) => a + b, 0)
      .toFixed(2);
    document.getElementById(
      "totalFilament"
    ).innerHTML = `${totalUsageMeter
      .reduce((a, b) => a + b, 0)
      .toFixed(2)}m / ${totalUsageGrams
      .reduce((a, b) => a + b, 0)
      .toFixed(2)}g`;
    const totalTimes = times.reduce((a, b) => a + b, 0);

    document.getElementById("totalPrintTime").innerHTML = Calc.generateTime(
      totalTimes
    );
    document.getElementById("printerTotalCost").innerHTML = printerCost
      .reduce((a, b) => a + b, 0)
      .toFixed(2);
    document.getElementById("combinedTotalCost").innerHTML = (
      parseFloat(printerCost.reduce((a, b) => a + b, 0).toFixed(2)) +
      parseFloat(cost.reduce((a, b) => a + b, 0).toFixed(2))
    ).toFixed(2);
  }
}
const element = document.getElementById("listenerHistory");
element.addEventListener(
  "jplist.state",
  (e) => {
    // the elements list after filtering + pagination
    History.updateTotals(e.jplistState.filtered);
  },
  false
);
History.get();

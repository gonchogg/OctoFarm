const express = require("express");

const router = express.Router();
const { ensureAuthenticated } = require("../config/auth");
const ServerSettingsDB = require("../models/ServerSettings.js");
const ClientSettingsDB = require("../models/ClientSettings.js");
const HistoryDB = require("../models/History");
const SpoolsDB = require("../models/Filament.js");
const ProfilesDB = require("../models/Profiles.js");
const roomDataDB = require("../models/roomData.js");
const UserDB = require("../models/User.js");
const PrinterDB = require("../models/Printer.js");
const AlertsDB = require("../models/Alerts.js");

const Logger = require('../lib/logger.js');

const logger = new Logger('OctoFarm-API');


const runner = require("../runners/state.js");
const multer = require('multer');

const { Runner } = runner;

const systemInfo = require("../runners/systemInfo.js");

const SystemInfo = systemInfo.SystemRunner;

const settingsClean = require("../lib/dataFunctions/settingsClean.js");

const { SettingsClean } = settingsClean;

const serverCommands = require("../lib/serverCommands.js");

const { Logs } = serverCommands;
const { SystemCommands } = serverCommands;

module.exports = router;

// var upload = multer({ dest: "Upload_folder_name" })
// If you do not want to use diskStorage then uncomment it

const Storage = multer.diskStorage({
    destination: function(req, file, callback) {
        callback(null, "./images");
    },
    filename: function(req, file, callback) {
        callback(null, "bg.jpg");
    }
});

const upload = multer({ storage: Storage });

router.get("/server/get/logs", ensureAuthenticated, async (req, res) => {
    const serverLogs = await Logs.grabLogs();
    res.send(serverLogs);
});
router.get("/server/download/logs/:name", ensureAuthenticated, (req, res) => {
    const download = req.params.name;
    const file = `./logs/${download}`;
    res.download(file, download); // Set disposition and send it.
});
router.get("/server/delete/database/:name", ensureAuthenticated, async (req, res) => {
    const databaseName = req.params.name;
    console.log(databaseName);
    await Runner.pause();
    if(databaseName === "nukeEverything"){
        await ServerSettingsDB.deleteMany({});
        await ClientSettingsDB.deleteMany({});
        await HistoryDB.deleteMany({});
        await SpoolsDB.deleteMany({});
        await ProfilesDB.deleteMany({});
        await roomDataDB.deleteMany({});
        await UserDB.deleteMany({});
        await PrinterDB.deleteMany({});
        await AlertsDB.deleteMany({});
        res.send({message: "Successfully deleted databases, server will restart..."});
        logger.info('Database completely wiped.... Restarting server...');
        SystemCommands.rebootOctoFarm();
    }else if(databaseName === "FilamentDB"){
        await SpoolsDB.deleteMany({});
        await ProfilesDB.deleteMany({});
        logger.info('Successfully deleted Filament database.... Restarting server...');
        SystemCommands.rebootOctoFarm();
    }else{
        await eval(databaseName).deleteMany({});
        res.send({message: "Successfully deleted "+databaseName+", server will restart..."});
        logger.info(databaseName + ' successfully deleted.... Restarting server...');
        SystemCommands.rebootOctoFarm();
    }


});
router.get("/server/restart", ensureAuthenticated, (req, res) => {
    SystemCommands.rebootOctoFarm();
});
router.get("/client/get", ensureAuthenticated, (req, res) => {
    ClientSettingsDB.find({}).then((checked) => {
        res.send(checked[0]);
    });
});
router.post("/client/update", ensureAuthenticated, (req, res) => {
    ClientSettingsDB.find({}).then((checked) => {
        const panelView = {
            currentOp: req.body.panelView.currentOp,
            hideOff: req.body.panelView.hideOff,
            hideClosed: req.body.panelView.hideClosed,
            extraInfo: req.body.panelView.extraInfo,
        };
        const listView = {
            currentOp: req.body.listView.currentOp,
            hideOff: req.body.listView.hideOff,
            hideClosed: req.body.listView.hideClosed,
            extraInfo: req.body.listView.extraInfo,
        };
        const cameraView = {
            currentOp: req.body.cameraView.currentOp,
            cameraRows: req.body.cameraView.cameraRows,
            hideClosed: req.body.cameraView.hideClosed,
            extraInfo: req.body.cameraView.extraInfo,
        };
        checked[0].panelView = panelView;
        checked[0].listView = listView;
        checked[0].cameraView = cameraView;
        checked[0].dashboard = req.body.dashboard;
        checked[0].save().then(() => {
            SettingsClean.start();
        });

        res.send({ msg: "Settings Saved" });
    });
});
router.post("/backgroundUpload", ensureAuthenticated,upload.single('myFile'), (req, res) => {
    const file = req.file;
    if (!file) {
        res.redirect("/system");
    }
    res.redirect("/system");
});
router.get("/server/get", ensureAuthenticated, (req, res) => {
    ServerSettingsDB.find({}).then((checked) => {
        res.send(checked[0]);
    });
});
router.post("/server/update", ensureAuthenticated, (req, res) => {
    ServerSettingsDB.find({}).then(async (checked) => {
        checked[0].onlinePolling = req.body.onlinePolling;
        Runner.updatePoll();
        checked[0].server = req.body.server;
        checked[0].timeout = req.body.timeout;
        checked[0].filament = req.body.filament;
        await checked[0].save().then(() => {
            SettingsClean.start();
        });
        res.send({ msg: "Settings Saved" });
    });
});
router.get("/sysInfo", ensureAuthenticated, async (req, res) => {
    const systemInformation = await SystemInfo.returnInfo();
    // There is a circular structure in here somewhere!?
    let sysInfo = null;
    if (typeof systemInformation !== "undefined") {
        sysInfo = {
            osInfo: systemInformation.osInfo,
            cpuInfo: systemInformation.cpuInfo,
            cpuLoad: systemInformation.cpuLoad,
            memoryInfo: systemInformation.memoryInfo,
            sysUptime: systemInformation.sysUptime,
            sysProcess: systemInformation.sysProcess,
            processUptime: systemInformation.processUptime,
        };
    }
    res.send(sysInfo);
});

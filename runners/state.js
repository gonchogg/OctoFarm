
const Printers = require("../models/Printer.js");
const serverSettings = require("../settings/serverSettings.js");
const ServerSettings = serverSettings.ServerSettings;
const statisticsCollection = require("../runners/statisticsCollection.js");
const StatisticsCollection = statisticsCollection.StatisticsCollection;
const historyCollection = require("./history.js");
const HistoryCollection = historyCollection.HistoryCollection;
const fetch = require("node-fetch");
const _ = require("lodash");
const WebSocket = require("ws");
const Filament = require("../models/Filament.js");
const timeout = require("../serverConfig/timeout.js");
const Logger = require('../lib/logger.js');
const logger = new Logger('OctoFarm-State')

let farmPrinters = [];

let statRunner = null;
let farmStatRunner = null;

//Checking interval for information...
// setInterval(() => {
//   console.log(farmPrinters[0])
// }, 10000);


function WebSocketClient(){
  this.number = 0;	// Message number
  this.autoReconnectInterval = timeout.webSocketRetry;	// ms
}
WebSocketClient.prototype.open = function(url, index){
  if(url.includes("http://")){
    url = url.replace("http://","")
  }
  if(url.includes("https://")){
    url = url.replace("https://","")
  }
  this.url = url;
  this.index = index;
  farmPrinters[this.index].webSocket = "warning";
  this.instance = new WebSocket(this.url);
  this.instance.on('open',()=>{
    this.onopen(this.index);
  });
  this.instance.on('message',(data,flags)=>{
    this.number ++;
    this.onmessage(data,flags,this.number, this.index);
  });
  this.instance.on('close',(e)=>{
    switch (e){
      case 1000:	// CLOSE_NORMAL
        logger.info("WebSocket: closed: "  + this.index + ": " + this.url);
        break;
      case 1005:	// CLOSE_NORMAL
        logger.info("WebSocket: closed: "  + this.index + ": " + this.url);
        break;
      case 1006:	// CLOSE_NORMAL
        logger.info("WebSocket: closed: "  + this.index + ": " + this.url);
        break;
      default:	// Abnormal closure
        this.reconnect(e);
        break;
    }
    this.onclose(e);
    return "closed";
  });
  this.instance.on('error',(e)=>{
    switch (e.code){
      case 'ECONNREFUSED':
        logger.error(e, this.index + ": " + this.url);
        try {
          farmPrinters[this.index].state = "Offline";
          farmPrinters[this.index].stateColour = Runner.getColour("Offline");
          farmPrinters[this.index].hostState = "Shutdown";
          farmPrinters[this.index].hostStateColour = Runner.getColour("Shutdown");
          farmPrinters[this.index].webSocket = "danger";

        }catch(e){
          logger.info("Couldn't set state of missing printer, safe to ignore: "  + this.index + ": " + this.url)
        }
        this.reconnect(e);
        break;
      case 'ECONNRESET':
        logger.error(e, this.index + ": " + this.url);
        try {
          farmPrinters[this.index].state = "Offline";
          farmPrinters[this.index].stateColour = Runner.getColour("Offline");
          farmPrinters[this.index].hostState = "Shutdown";
          farmPrinters[this.index].hostStateColour = Runner.getColour("Shutdown");
          farmPrinters[this.index].webSocket = "danger";
        }catch(e){
          logger.info("Couldn't set state of missing printer, safe to ignore: "  + this.index + ": " + this.url)
        }
        this.reconnect(e);
        break;
      case 'EHOSTUNREACH':
        logger.error(e, this.index + ": " + this.url);
        try {
          farmPrinters[this.index].state = "Offline";
          farmPrinters[this.index].stateColour = Runner.getColour("Offline");
          farmPrinters[this.index].hostState = "Shutdown";
          farmPrinters[this.index].hostStateColour = Runner.getColour("Shutdown");
          farmPrinters[this.index].webSocket = "danger";
        }catch(e){
          logger.info("Couldn't set state of missing printer, safe to ignore: "  + this.index + ": " + this.url)
        }
        this.reconnect(e);
        break;
      default:
        logger.error(e, this.index + ": " + this.url);
        try {
          farmPrinters[this.index].state = "Offline";
          farmPrinters[this.index].stateColour = Runner.getColour("Offline");
          farmPrinters[this.index].hostState = "Shutdown";
          farmPrinters[this.index].hostStateColour = Runner.getColour("Shutdown");
          farmPrinters[this.index].webSocket = "danger";
        }catch(e){
          logger.info("Couldn't set state of missing printer, safe to ignore: "  + this.index + ": " + this.url)
        }
        logger.error("WebSocket hard failure: "  + this.index + ": " + this.url);
        this.reconnect(e);
        break;
    }
  });
  return true;
};
WebSocketClient.prototype.throttle = function(data){
  try{
    logger.info("Throttling your websocket connection: " + this.index + ": " + this.url + " ", data);
    farmPrinters[this.index].ws.send(JSON.stringify(data));
  }catch (e){
    logger.error("Failed to Throttle websocket: " + this.index + ": " + this.url);
    this.instance.emit('error',e);
  }
};
WebSocketClient.prototype.send = function(data,option){
  try{
    this.instance.send(data,option);
  }catch (e){
    this.instance.emit('error',e);
  }
};
WebSocketClient.prototype.reconnect = async function(e){
  logger.info(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`,e + this.index + ": " + this.url);
  this.instance.removeAllListeners();
  let that = this;
  setTimeout(function(){
    logger.info("Re-Opening Websocket: " + that.index + ": " + that.url);
    that.open(that.url, that.index);
  },this.autoReconnectInterval);
  return true;
};
WebSocketClient.prototype.onopen = async function(e){
  logger.info("WebSocketClient: open",arguments, this.index + ": " + this.url);
  let Polling = await ServerSettings.check();
  let data = {};
  let throt = {};
  data["auth"] = farmPrinters[this.index].currentUser + ":" + farmPrinters[this.index].apikey;
  throt["throttle"] = parseInt(
      (Polling[0].onlinePolling.seconds * 1000) / 500
  );
  //Send User Auth
  logger.info("Sending Auth to Websocket: " + this.index + ": " + this.url + " ", data);
  this.instance.send(JSON.stringify(data));
  this.instance.send(JSON.stringify(throt));
};
WebSocketClient.prototype.onmessage = async function(data,flags,number){
  //console.log("WebSocketClient: message",arguments);
  //Listen for print jobs
  data = await JSON.parse(data);
  if(typeof data.connected != "undefined"){
    farmPrinters[this.index].octoPrintVersion = data.connected.version;
    farmPrinters[this.index].markModified("octoPrintVersion");
    farmPrinters[this.index].save();
  }
  if (typeof data.event != "undefined") {
    if (data.event.type === "PrintFailed") {
      logger.info(data.event.type + this.index + ": " + this.url);
      //Register cancelled print...
      await HistoryCollection.failed(data.event.payload, farmPrinters[this.index]);
    }
    if (data.event.type === "PrintDone") {
      logger.info(data.event.type + this.index + ": " + this.url);
      //Register cancelled print...
      await HistoryCollection.complete(data.event.payload, farmPrinters[this.index]);
    }
  }
  //Listen for printer status
  if (typeof data.current != "undefined") {
    farmPrinters[this.index].webSocket = "success";
    if (data.current.state.text === "Offline") {
      data.current.state.text = "Disconnected";
    }else if(data.current.state.text.includes("Error:")){
      data.current.state.text = "Error!"
    }else if(data.current.state.text === "Closed"){
      data.current.state.text = "Disconnected";
    }

    farmPrinters[this.index].state = data.current.state.text;
    farmPrinters[this.index].stateColour = Runner.getColour(data.current.state.text);
    farmPrinters[this.index].currentZ = data.current.currentZ;
    farmPrinters[this.index].progress = data.current.progress;
    farmPrinters[this.index].job = data.current.job;
    farmPrinters[this.index].logs = data.current.logs;
    //console.log(data.current.temps.length != 0);
    //console.log(data.current.temps);
    if (data.current.temps.length !== 0) {
      farmPrinters[this.index].temps = data.current.temps;
      //console.log(farmPrinters[1].temps);
    }
    if (
        data.current.progress.completion != null &&
        data.current.progress.completion === 100
    ) {
      farmPrinters[this.index].stateColour = Runner.getColour("Complete");
    } else {
      farmPrinters[this.index].stateColour = Runner.getColour(
          data.current.state.text
      );
    }
  }
};
WebSocketClient.prototype.onerror = function(e){
  logger.error("WebSocketClient: Error",arguments,  + this.index + ": " + this.url);
  this.instance.removeAllListeners();
};
WebSocketClient.prototype.onclose = function(e){
  logger.info("WebSocketClient: Closed",arguments, this.index + ": " + this.url);
  this.instance.removeAllListeners();
};

class ClientAPI {
  static async get_retry(printerURL, apikey, item){
    try {
      logger.info("Attempting to connect to API: " + item + " | " + printerURL + " | timeout: " + timeout.apiTimeout);
      let apiConnect = await ClientAPI.get(printerURL, apikey, item);
      return apiConnect;
  } catch(err) {
      logger.error(err)
      //If timeout exceeds max cut off then give up... Printer is considered offline.
      if (timeout.apiTimeout >= timeout.apiRetryCutoff) {
        logger.info("Timeout Exceeded: " + item + " | " + printerURL);
        //Reset timeout for next printer...
        timeout.apiTimeout = Number(timeout.apiTimeout) - 9000;
        throw err;
      }
      timeout.apiTimeout = timeout.apiTimeout + 9000;
      logger.info("Attempting to re-connect to API: " + item + " | " + printerURL + " | timeout: " + timeout.apiTimeout);
      return await ClientAPI.get_retry(printerURL, apikey, item);
    }
  }

  static get(printerURL, apikey, item) {
    let url = `${printerURL}/api/${item}`;
      return Promise.race([
        fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apikey
          }
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeout.apiTimeout)
        )
      ]);
  }

}

class Runner {
  static async init() {
    farmPrinters = [];
    statRunner = setInterval(function() {
      //Update Current Operations
      StatisticsCollection.currentOperations(farmPrinters);
      //Update farm information when we have temps
      StatisticsCollection.farmInformation(farmPrinters);
      //Update print statistics
      StatisticsCollection.printStatistics();
    }, 500);
    farmStatRunner = setInterval(function() {
      //Update farm statistics
      StatisticsCollection.octofarmStatistics(farmPrinters);
    }, 5000);

    //Grab printers from database....
    try {
      farmPrinters = await Printers.find({}, null, { sort: { sortIndex: 1 } });
      logger.info("Grabbed " + farmPrinters.length + " for checking");
      for (let i = 0; i < farmPrinters.length; i++) {
        //Make sure runners are created ready for each printer to pass between...
        await Runner.setDefaults(farmPrinters[i]._id);
      }
    } catch (err) {
      let error = {
        err: err.message,
        action: "Database connection failed... No action taken",
        userAction:
            "Please make sure the database URL is inputted and can be reached... 'file located at: config/db.js'"
      };
      logger.error(err);
    }


    //cycle through printers and move them to correct checking location...
    await StatisticsCollection.init();
    for (let i = 0; i < farmPrinters.length; i++) {
      //Make sure runners are created ready for each printer to pass between...
      await Runner.setupWebSocket(farmPrinters[i]._id);
    }

    return (
        "System Runner has checked over " + farmPrinters.length + " printers..."
    );
  }

  static async setupWebSocket(id){
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    try{
      if(i === -1){
        let error = {message: 'Could not find printer...:', type: 'system', errno: 'DELETED', code: 'DELETED'};
        throw error;
      }
      const ws = new WebSocketClient();
      farmPrinters[i].state = "Searching...";
      farmPrinters[i].stateColour = Runner.getColour("Searching...");
      farmPrinters[i].hostState = "Searching...";
      farmPrinters[i].hostStateColour = Runner.getColour("Searching...");
      farmPrinters[i].webSocket = "warning";
      farmPrinters[i].ws = ws;
      //Make a connection attempt, and grab current user.
      let users = null;
      users = await ClientAPI.get_retry(farmPrinters[i].printerURL, farmPrinters[i].apikey, "users");
      if (users.status === 200) {
        users = await users.json();
        if (_.isEmpty(users)) {
          farmPrinters[i].currentUser = "admin";
          farmPrinters[i].markModified("currentUser");
          farmPrinters[i].save();
        } else {
          users.users.forEach(user => {
            if (user.admin) {
              farmPrinters[i].currentUser = user.name;
              farmPrinters[i].markModified("currentUser");
              farmPrinters[i].save();
            }
          });
        }
        //Update info via API
        farmPrinters[i].hostState = "Online";
        farmPrinters[i].hostStateColour = Runner.getColour("Online");
        await Runner.getProfile(id);
        await Runner.getSystem(id);
        await Runner.getSettings(id);
        await Runner.getState(id);
        await Runner.getFiles(id, "files?recursive=true");
        //Connection to API successful, gather initial data and setup websocket.
        await farmPrinters[i].ws.open(
            `ws://${farmPrinters[i].printerURL}/sockjs/websocket`,
            i
        );
      }else if(users.status === 503 || users.status === 404){
        let error = {message: 'Could not Establish connection to OctoPrint Returned: '+ users.status +': ' + farmPrinters[i].printerURL, type: 'system', errno: '503', code: '503'};
        throw error;
      }else{
        let error = {message: 'Could not Establish API Connection: ' + users.status + farmPrinters[i].printerURL, type: 'system', errno: 'NO-API', code: 'NO-API'};
        throw error;
      }
    }catch(e){
      switch (e.code){
        case 'NO-API':
          logger.error(e.message,"Couldn't grab initial connection for Printer: " + farmPrinters[i].printerURL);
          try {
            farmPrinters[i].state = "No-API";
            farmPrinters[i].stateColour = Runner.getColour("No-API");
            farmPrinters[i].hostState = "Offline";
            farmPrinters[i].hostStateColour = Runner.getColour("Offline");
            farmPrinters[i].webSocket = "danger";
          }catch(e){
            logger.error("Couldn't set state of missing printer, safe to ignore: "  + farmPrinters[i].index + ": " + farmPrinters[i].printerURL)
          }
          setTimeout(function(){ Runner.setupWebSocket(id); }, timeout.apiRetry);
          break;
        case 'DELETED':
          logger.error(e.message,"Printer Deleted... Do not retry to connect");
          break;
        default:
          logger.error(e.message,"Couldn't grab initial connection for Printer: " + farmPrinters[i].printerURL);
          try {
            farmPrinters[i].state = "Offline";
            farmPrinters[i].stateColour = Runner.getColour("Offline");
            farmPrinters[i].hostState = "Shutdown";
            farmPrinters[i].hostStateColour = Runner.getColour("Shutdown");
            farmPrinters[i].webSocket = "danger";
          }catch(e){
            logger.error("Couldn't set state of missing printer, safe to ignore: "  + farmPrinters[i].index + ": " + farmPrinters[i].printerURL)
          }
          setTimeout(function(){ Runner.setupWebSocket(id); }, timeout.apiRetry);
          break;
      }
    }
    return true;
  }

  static async setDefaults(id){
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    let printer = await Printers.findById(id);
    logger.info("Setting up defaults for Printer: " + printer.printerURL);
    farmPrinters[i].state = "Disconnected";
    farmPrinters[i].stateColour = Runner.getColour("Disconnected");
    farmPrinters[i].hostState = "Searching...";
    farmPrinters[i].hostStateColour = Runner.getColour("Searching...");
    farmPrinters[i].webSocket = "danger";
    farmPrinters[i].stepRate = 10;
    if(typeof farmPrinters[i].octoPrintVersion === "undefined"){
      farmPrinters[i].octoPrintVersion = "";
    }
    if(typeof farmPrinters[i].tempTriggers === "undefined"){
      farmPrinters[i].tempTriggers = {
        heatingVariation: 1,
        coolDown: 30,
      }
    }
    if (typeof farmPrinters[i].feedRate === "undefined") {
      farmPrinters[i].feedRate = 100;
    }
    if (typeof farmPrinters[i].flowRate === "undefined") {
      farmPrinters[i].flowRate = 100;
    }
    if (typeof farmPrinters[i].sortIndex === "undefined") {
      if(farmPrinters.length === 0){
        farmPrinters[i].sortIndex = 0;
      }else if(farmPrinters.length > 0){
        farmPrinters[i].sortIndex = farmPrinters.length-1;
      }
    }
    if (typeof farmPrinters[i].group === "undefined"){
      farmPrinters[i].group = "";
    }
    if (typeof farmPrinters[i].printerURL === "undefined"){
      farmPrinters[i].printerURL = "http://" + farmPrinters[i].ip + ":" + farmPrinters[i].port;
    }
    if(typeof farmPrinters[i].printerURL !== "undefined" && !farmPrinters[i].printerURL.includes("https://") && !farmPrinters[i].printerURL.includes("http://")){
      farmPrinters[i].printerURL = "http://" + farmPrinters[i].printerURL;
    }
    if (typeof farmPrinters[i].camURL !== "undefined" && farmPrinters[i].camURL !== "" && !farmPrinters[i].camURL.includes("http")){
      if(typeof farmPrinters[i].camURL !== "undefined" && farmPrinters[i].camURL.includes("{Set") || farmPrinters[i].camURL === "none"){
        farmPrinters[i].camURL = "none"
      }else{
        farmPrinters[i].camURL = "http://" + farmPrinters[i].camURL;
      }
    }
    printer.octoPrintVersion = farmPrinters[i].octoPrintVersion;
    printer.camURL = farmPrinters[i].camURL;
    printer.printerURL = farmPrinters[i].printerURL;
    printer.feedRate = farmPrinters[i].feedRate;
    printer.flowRate = farmPrinters[i].flowRate;
    printer.sortIndex = farmPrinters[i].sortIndex;
    printer.tempTriggers = farmPrinters[i].tempTriggers;
    await printer.save();
    return true;
  }
  static async addPrinters(printers){
    logger.info("Adding single printer to farm");
    //Only adding a single printer
    let newPrinter = await new Printers(printers[0]);
    await newPrinter.save();
    logger.info("Saved new Printer: " + newPrinter.printerURL);
    farmPrinters.push(newPrinter)
    await this.setDefaults(newPrinter._id);
    await this.setupWebSocket(newPrinter._id);
    return [newPrinter];
  }
  static async updatePrinters(printers){
      //Updating printer's information
      logger.info("Pausing runners to update printers...");
      await this.pause();
      let edited = []
      for (let i = 0; i < printers.length; i++) {
        let index = _.findIndex(farmPrinters, function(o) { return o._id == printers[i]._id; });
          farmPrinters[index].settingsApperance.name = printers[i].settingsApperance.name;
          farmPrinters[index].markModified("settingsApperance");
          logger.info("Modified current name  for: " + farmPrinters[i].printerURL);
          farmPrinters[index].printerURL = printers[i].printerURL;
          farmPrinters[index].markModified("printerURL");
          logger.info("Modified current printer URL  for: " + farmPrinters[i].printerURL);
          farmPrinters[index].camURL = printers[i].camURL
          farmPrinters[index].markModified("camURL");
          logger.info("Modified current camera URL for: " + farmPrinters[i].printerURL);
          farmPrinters[index].apikey = printers[i].apikey;
          farmPrinters[index].markModified("apikey");
          logger.info("Modified current printer name for: " + farmPrinters[i].printerURL);
          farmPrinters[index].group = printers[i].group;
          farmPrinters[index].markModified("group");
          logger.info("Modified current printer name for: " + farmPrinters[i].printerURL);
          await farmPrinters[index].save();
          edited.push({printerURL: farmPrinters[i].printerURL})
      }
      logger.info("Re-Scanning printers farm");
      this.init();
      return edited;
  }
  static async removePrinter(indexs){
    logger.info("Pausing runners to remove printer...");
    await this.pause();
    let removed = []
    for(let i = 0; i < indexs.length; i++){
      let index = _.findIndex(farmPrinters, function(o) { return o._id == indexs[i]; });
      logger.info("Removing printer from database: " + farmPrinters[index].printerURL);
      removed.push({printerURL: farmPrinters[index].printerURL, printerId: indexs[i]});
      await farmPrinters.splice(index, 1);
      //Splice printer out of farm Array...
      let remove = await Printers.findOneAndDelete({ _id: indexs[i] });
    }
    //Regenerate Indexs
    for(let p = 0; p < farmPrinters.length; p++){
      await logger.info("Regenerating existing indexes: " + farmPrinters[p].printerURL);
      farmPrinters[p].sortIndex = p;
      await farmPrinters[p].save();
    }
    logger.info("Re-Scanning printers farm");
    this.init();
    return removed;
  }

  static async reScanOcto(id) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    let result = {
      status: null,
      msg: null
    };
    farmPrinters[index].state = "Searching...";
    farmPrinters[index].stateColour = Runner.getColour("Searching...");
    farmPrinters[index].hostState = "Searching...";
    farmPrinters[index].hostStateColour = Runner.getColour("Searching...");
    if(farmPrinters[index].webSocket === "danger"){
        await Runner.setupWebSocket(id)
        result.status = "error";
        result.msg =
            "Printer: " +
            index +
            " please check CORS, and make sure your OctoPrint instance is fully booted if it hasn't come online...";


    }else if(farmPrinters[index].webSocket === "success"){
      logger.info("Socket already Online, Updating information for: " + farmPrinters[index].printerURL);
      await Runner.getProfile(id);
      await Runner.getSystem(id);
      await Runner.getSettings(id);
      await Runner.getState(id);
      await Runner.getFiles(id, "files?recursive=true");
      result.status = "success";
      result.msg =
          "Printer: " +
          index +
          " has been successfully re-synced with OctoPrint.";
      farmPrinters[index].hostState = "Online";
      farmPrinters[index].hostStateColour = Runner.getColour("Online");
    }else{
      await Runner.setupWebSocket(id)
      result.status = "warning";
      result.msg =
          "Printer: " +
          index +
          " have attempted a force re-connect.";
    }
    return result;
  }
  static async updatePoll() {
    for (let i = 0; i < farmPrinters.length; i++) {
      let Polling = await ServerSettings.check();
      let throt = {};
      throt["throttle"] = parseInt(
        (Polling[0].onlinePolling.seconds * 1000) / 500
      );
      if(typeof farmPrinters[i].ws.instance != 'undefined'){
        await farmPrinters[i].ws.throttle(JSON.stringify(throt));
      }
    }
    return "updated";
  }
  static async pause() {

    logger.info("Stopping farm statistics runner...");
    clearInterval(farmStatRunner);
    logger.info("Stopping farm Information runner...");
    clearInterval(statRunner);
    for (let i = 0; i < farmPrinters.length; i++) {
      if(typeof farmPrinters[i].ws !== 'undefined' && typeof farmPrinters[i].ws.instance !== 'undefined'){
        await farmPrinters[i].ws.instance.close();
        logger.info("Closed websocket connection for: " + farmPrinters[i].printerURL);
      }
    }
    return true;
  }




  static getFiles(id, location) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    //Shim to fix undefined on upload files/folders
    farmPrinters[index].fileList = {
      files: [],
      fileCount: 0,
      folders: [],
      folderCount: 0
    };
    return ClientAPI.get_retry(
      farmPrinters[index].printerURL,
      farmPrinters[index].apikey,
      location
    )
      .then(res => {
        return res.json();
      })
      .then(res => {

        //Setup the files json storage object
        farmPrinters[index].storage = {
          free: res.free,
          total: res.total
        };
        //Setup the files location object to place files...
        let printerFiles = [];
        let printerLocations = [];
        let recursivelyPrintNames = function(entry, depth) {
          depth = depth || 0;
          let timeStat = "";
          let isFolder = entry.type === "folder";
          if (!isFolder) {
            if (entry.gcodeAnalysis !== undefined) {
              if (entry.gcodeAnalysis.estimatedPrintTime !== undefined) {
                timeStat = entry.gcodeAnalysis.estimatedPrintTime;
              } else {
                timeStat = "No Time Estimate";
              }
            } else {
              timeStat = "No Time Estimate";
            }
            let path = null;
            if (entry.path.indexOf("/") > -1) {
              path = entry.path.substr(0, entry.path.lastIndexOf("/"));
            } else {
              path = "local";
            }
            let file = {
              path: path,
              fullPath: entry.path,
              display: entry.display,
              name: entry.name,
              size: entry.size,
              time: timeStat,
              date: entry.date,
            };
            printerFiles.push(file);
          }
          let folderPaths = {
            name: "",
            path: ""
          };
          if (isFolder) {
            if (entry.path.indexOf("/") > -1) {
              folderPaths.path = entry.path.substr(
                0,
                entry.path.lastIndexOf("/")
              );
            } else {
              folderPaths.path = "local";
            }

            if (entry.path.indexOf("/")) {
              folderPaths.name = entry.path;
            } else {
              folderPaths.name = entry.path.substr(
                0,
                entry.path.lastIndexOf("/")
              );
            }
            printerLocations.push(folderPaths);
          }
          farmPrinters[index].fileList = {
            files: printerFiles,
            fileCount: printerFiles.length,
            folders: printerLocations,
            folderCount: printerLocations.length
          };

          if (isFolder) {
            _.each(entry.children, function(child) {
              recursivelyPrintNames(child, depth + 1);
            });
          }
        };
        _.each(res.files, function(entry) {
          recursivelyPrintNames(entry);
        });
        logger.info("Successfully grabbed Current State for...: " + farmPrinters[index].printerURL);
      })
      .catch(err => {
        logger.error("Error grabbing files for: " + farmPrinters[index].printerURL + ": Reason: ", err);
        return false;
      });
  }
  static getState(id) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    return ClientAPI.get_retry(
      farmPrinters[index].printerURL,
      farmPrinters[index].apikey,
      "connection"
    )
      .then(res => {
        return res.json();
      })
      .then(res => {
        //Update info to DB
        if (res.current.state === "Offline") {
          res.current.state = "Disconnected";
        }else if(res.current.state.includes("Error:")){
          res.current.state = "Error!"
        }else if(res.current.state === "Closed"){
          res.current.state = "Disconnected";
        }
        farmPrinters[index].state = res.current.state;
        farmPrinters[index].stateColour = Runner.getColour(res.current.state);
        farmPrinters[index].current = res.current;
        farmPrinters[index].options = res.options;
        logger.info("Successfully grabbed Current State for...: " + farmPrinters[index].printerURL);
      })
      .catch(err => {
        logger.error("Error grabbing state for: " + farmPrinters[index].printerURL + "Reason: ", err);
        return false;
      });
  }
  static getProfile(id) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    return ClientAPI.get_retry(
      farmPrinters[index].printerURL,
      farmPrinters[index].apikey,
      "printerprofiles"
    )
      .then(res => {
        return res.json();
      })
      .then(res => {
        //Update info to DB
        farmPrinters[index].profiles = res.profiles;
        logger.info("Successfully grabbed Profiles for...: " + farmPrinters[index].printerURL);
      })
      .catch(err => {
        logger.error("Error grabbing profile for: " + farmPrinters[index].printerURL + ": Reason: ", err);
        return false;
      });
  }
  static getSettings(id) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    return ClientAPI.get_retry(
      farmPrinters[index].printerURL,
      farmPrinters[index].apikey,
      "settings"
    )
      .then(res => {
        return res.json();
      })
      .then(async res => {
        //Update info to DB
        farmPrinters[index].settingsApi = res.api;
        let appearance = null;
        if(farmPrinters[index].settingsApperance.name === "" || farmPrinters[index].settingsApperance.name.includes("{Leave")){
          //If new name is supplied then update the name...
          appearance = res.appearance;
          appearance.name = res.appearance.name;
          farmPrinters[index].settingsApperance = appearance;
        }
        let printer = await Printers.findById( id );
        printer.settingsApperance = farmPrinters[index].settingsApperance;
        farmPrinters[index].settingsApperance
        printer.save();
        farmPrinters[index].settingsFeature = res.feature;
        farmPrinters[index].settingsFolder = res.folder;
        farmPrinters[index].settingsPlugins = res.plugins;
        farmPrinters[index].settingsScripts = res.scripts;
        farmPrinters[index].settingsSerial = res.serial;
        farmPrinters[index].settingsServer = res.server;
        farmPrinters[index].settingsSystem = res.system;
        farmPrinters[index].settingsWebcam = res.webcam;
        if (
          farmPrinters[index].camURL === "" ||
          farmPrinters[index].camURL === null && farmPrinters[index].camURL !== "none"
        ) {
          if (
            typeof res.webcam != "undefined" &&
            typeof res.webcam.streamUrl != "undefined" &&
            res.webcam.streamUrl != null
          ) {
            if (res.webcam.streamUrl.includes("http")) {
              farmPrinters[index].camURL = res.webcam.streamUrl;
              farmPrinters[index].camURL = farmPrinters[index].camURL.replace(
                "http://",
                ""
              );
            } else {
              farmPrinters[index].camURL =
                farmPrinters[index].printerURL +
                res.webcam.streamUrl;
            }
            let printer = await Printers.findOne({ index: index });
            printer.camURL = farmPrinters[index].camURL;
            printer.save();

          }
        }
        logger.info("Successfully grabbed Settings for...: " + farmPrinters[index].printerURL);
      })
      .catch(err => {
        logger.error("Error grabbing settings for: " + farmPrinters[index].printerURL + ": Reason: ", err);
        return false;
      });
  }
  static getSystem(id) {
    let index = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    return ClientAPI.get_retry(
      farmPrinters[index].printerURL,
      farmPrinters[index].apikey,
      "system/commands"
    )
      .then(res => {
        return res.json();
      })
      .then(res => {
        //Update info to DB
        farmPrinters[index].core = res.core;
        logger.info("Successfully grabbed System Information for...: " + farmPrinters[index].printerURL);
      })
      .catch(err => {
        logger.error("Error grabbing system for: " + farmPrinters[index].printerURL + ": Reason: ", err);
        return false;
      });
  }
  static getColour(state) {
    if (state === "Operational") {
      return { name: "secondary", hex: "#262626", category: "Idle" };
    } else if (state === "Paused") {
      return { name: "warning", hex: "#583c0e", category: "Idle" };
    } else if (state === "Printing") {
      return { name: "warning", hex: "#583c0e", category: "Active" };
    } else if (state === "Pausing") {
      return { name: "warning", hex: "#583c0e", category: "Active" };
    } else if (state === "Cancelling") {
      return { name: "warning", hex: "#583c0e", category: "Active" };
    } else if (state === "Error") {
      return { name: "danger", hex: "#2e0905", category: "Idle" };
    } else if (state === "Offline") {
      return { name: "danger", hex: "#2e0905", category: "Offline" };
    } else if (state === "Searching...") {
      return { name: "danger", hex: "#2e0905", category: "Offline" };
    } else if (state === "Disconnected") {
      return { name: "danger", hex: "#2e0905", category: "Disconnected" };
    } else if (state === "Complete") {
      return { name: "success", hex: "#00330e", category: "Complete" };
    } else if (state === "Shutdown") {
      return { name: "danger", hex: "#00330e", category: "Offline" };
    }else if (state === "Online") {
      return { name: "success", hex: "#00330e", category: "Idle" };
    }else{
      return { name: "danger", hex: "#00330e", category: "Offline" };
    }
  }
  static returnFarmPrinters(index) {
    if(typeof index === 'undefined'){
      return farmPrinters;
    }else{
      let i = _.findIndex(farmPrinters, function(o) { return o._id == index; });
      return farmPrinters[i];
    }

  }
  static async removeFile(printer, fullPath) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == printer._id; });
    let index = await _.findIndex(farmPrinters[i].fileList.files, function(o) {
      return o.fullPath === fullPath;
    });
    farmPrinters[i].fileList.files.splice(index, 1);
    farmPrinters[i].fileList.fileCount = farmPrinters[i].fileList.files.length;
  }

  static async reSyncFile(id) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    //Doesn't actually resync just the file... shhh
    let success = await Runner.getFiles(id, "files?recursive=true");
    if (success) {
      return success;
    } else {
      return false;
    }
  }
  static async flowRate(id, newRate) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    farmPrinters[i].flowRate = newRate;
    let printer = await Printers.findById(id);
    printer.flowRate = farmPrinters[i].flowRate;
    printer.save();
  }
  static async feedRate(id, newRate) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    farmPrinters[i].feedRate = newRate;
    let printer = await Printers.findById( id);
    printer.feedRate = farmPrinters[i].feedRate;
    printer.save();
  }
  static async updateSortIndex(list) {
    //Update the live information
    for (let i = 0; i < farmPrinters.length; i++) {
      let id = _.findIndex(farmPrinters, function(o) { return o._id == list[i]; });
      farmPrinters[id].sortIndex = i;
      let printer = await Printers.findById(list[i]);
      printer.sortIndex = i;
      printer.save();
    }
  }
  static stepRate(id, newRate) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    farmPrinters[i].stepRate = newRate;
  }
  static async updateSettings(id, opts) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    farmPrinters[i].settingsScripts.gcode = opts.scripts.gcode;
    farmPrinters[i].settingsApperance.name = opts.appearance.name;
    farmPrinters[i].settingsWebcam = opts.webcam;
    farmPrinters[i].camURL = opts.camURL;
    let printer = await Printers.findOne({ index: i });
    printer.settingsWebcam = farmPrinters[i].settingsWebcam;
    printer.camURL = farmPrinters[i].camURL;
    printer.settingsApperance.name = farmPrinters[i].settingsApperance.name;
    printer.save();
  }
  //Keeping just in case but shouldn't be required...
  // static async selectFilament(i, filament) {
  //   farmPrinters[i].selectedFilament = filament;
  //   let printer = await Printers.findOne({ index: i });
  //   printer.selectedFilament = farmPrinters[i].selectedFilament;
  //   printer.save();
  // }
  static moveFile(id, newPath, fullPath, filename) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    let file = _.findIndex(farmPrinters[i].fileList.files, function(o) {
      return o.name === filename;
    });
    //farmPrinters[i].fileList.files[file].path = newPath;
    farmPrinters[i].fileList.files[file].path = newPath;
    farmPrinters[i].fileList.files[file].fullPath = fullPath;
    //console.log(farmPrinters[i].fileList.files)
  }
  static moveFolder(id, oldFolder, fullPath, folderName) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    let file = _.findIndex(farmPrinters[i].fileList.folders, function(o) {
      return o.name === oldFolder;
    });
    farmPrinters[i].fileList.files.forEach((file, index) => {
      if (file.path === oldFolder) {
        let fileName = farmPrinters[i].fileList.files[index].fullPath.substring(
          farmPrinters[i].fileList.files[index].fullPath.lastIndexOf("/") + 1
        );
        farmPrinters[i].fileList.files[index].fullPath =
          folderName + "/" + fileName;
        farmPrinters[i].fileList.files[index].path = folderName;
      }
    });
    farmPrinters[i].fileList.folders[file].name = folderName;
    farmPrinters[i].fileList.folders[file].path = fullPath;
  }
  static deleteFolder(id, fullPath) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == id; });
    farmPrinters[i].fileList.files.forEach((file, index) => {
      if (file.path === fullPath) {
        farmPrinters[i].fileList.files.splice(index, 1);
      }
    });
    farmPrinters[i].fileList.folders.forEach((folder, index) => {
      if (folder.path === fullPath) {
        farmPrinters[i].fileList.folders.splice(index, 1);
      }
    });
    let folder = _.findIndex(farmPrinters[i].fileList.folders, function(o) {
      return o.name === fullPath;
    });
    farmPrinters[i].fileList.folders.splice(folder, 1);
    farmPrinters[i].fileList.fileCount = farmPrinters[i].fileList.files.length;
    farmPrinters[i].fileList.folderCount =
      farmPrinters[i].fileList.folders.length;
  }
  static newFolder(folder) {
    let index = folder.i;
    let i = _.findIndex(farmPrinters, function(o) { return o._id == index; });
    let path = "local";
    let name = folder.foldername;
    if (folder.path !== "") {
      path = folder.path;
      name = path + "/" + name;
    }
    name = name.replace(/ /g,"_");
    let newFolder = {
      name: name,
      path: path
    };

    farmPrinters[i].fileList.folders.push(newFolder);
    farmPrinters[i].fileList.folderCount =
      farmPrinters[i].fileList.folders.length;
  }
  static async selectedFilament(filament) {
    let printer = await Printers.findById(filament.index);
    let printerIndex = _.findIndex(farmPrinters, function(o) { return o._id == filament.index; });
    if (filament.id === "") {
      farmPrinters[printerIndex].selectedFilament = {
        id: null,
        name: null,
        type: null,
        colour: null,
        manufacturer: null
      };
    } else {
      let rolls = await Filament.findById(filament.id );
      farmPrinters[printerIndex ].selectedFilament = {
        id: filament.id,
        name: rolls.roll.name,
        type: rolls.roll.type,
        colour: rolls.roll.colour,
        manufacturer: rolls.roll.manufacturer
      };
    }

    printer.selectedFilament = farmPrinters[printerIndex ].selectedFilament;
    printer.save();
    return farmPrinters[printerIndex ].selectedFilament;
  }
  static newFile(file) {
    let i = _.findIndex(farmPrinters, function(o) { return o._id == file.index; });
    let date = file.date;
    file = file.files.local;

    let path = "";
    if (file.path.indexOf("/") > -1) {
      path = file.path.substr(0, file.path.lastIndexOf("/"));
    } else {
      path = "local";
    }
    let fileDisplay = file.name.replace(/_/g, ' ');
    let data = {
      path: path,
      fullPath: file.path,
      display: fileDisplay,
      name: file.name,
      size: null,
      time: null,
      date: date
    };
    farmPrinters[i].fileList.files.push(data);
  }
  static sortedIndex() {
    let sorted = [];
    for(let p = 0; p < farmPrinters.length; p++ ){
      let sort = {
        sortIndex: farmPrinters[p].sortIndex,
        actualIndex: p
      }
      sorted.push(sort);
    }
    sorted.sort((a, b) => (a.sortIndex > b.sortIndex ? 1 : -1));
    return sorted;
  }
}

module.exports = {
  Runner: Runner
};

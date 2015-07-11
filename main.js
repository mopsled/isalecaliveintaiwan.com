var express = require("express"),
    url = require("url"),
    request = require("request"),
    bodyParser = require("body-parser"),
    fs = require("fs"),
    twilio = require("twilio"),
    util = require("util"),
    qs = require("querystring"),
    Promise = require("bluebird"),
    replay = require("request-replay"),
    debug = require("debug")("iaait.com"),
    moment = require("moment"),
    later = require("later"),
    lwip = require("lwip");

var store = {};

var descriptions = {
  "0-4": [
    "Unquestionably",
    "Undediably"
  ],
  "4-24": [
    "Obviously",
    "Doubtlessly",
    "Clearly",
    "Surely"
  ],
  "24-48": [
    "Presumably",
    "Presumptively",
    "Seemingly",
    "Probably",
    "Most likely"
  ],
  "48-72": [
    "Maybe",
    "Imaginably",
    "Plausibly",
    "Feasibly",
    "Indeterminately"
  ],
  "72+": [
    "Questionably",
    "Uncertainly",
    "Undecidedly",
    "Dubiously",
    "Disputably"
  ]
}

var client;
exports.getTwilioClient = function() {
  if (client) {
    return client;
  }

  client = new twilio.RestClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
};

exports.getLatestMms = function() {
  var client = exports.getTwilioClient();
  var mostRecentMMSMessage;

  return client.messages.get({from: process.env.TRUSTED_PHONE_NUMBER}).then(function(allMessagesResponse) {
    if (!allMessagesResponse) {
      throw new Error("Couldn't find any messages from " + process.env.TRUSTED_PHONE_NUMBER);
    }

    for (var i = 0; i < allMessagesResponse.messages.length; i++) {
      var message = allMessagesResponse.messages[i];
      if (message.num_media == "1" && message.body.match(new RegExp(process.env.MMS_SECRET))) {
        mostRecentMMSMessage = message;
        break;
      }
    }

    if (!mostRecentMMSMessage) {
      throw new Error("Couldn't find a most recent SMS message");
    }

    return client.messages(mostRecentMMSMessage.sid).media.get();
  }).then(function(allMediaResponse) {
    if (!allMediaResponse.media_list || !allMediaResponse.media_list[0].sid) {
      throw new Error("Couldn't find a media sid for media that was indended to have an attachment");
    }

    var media = allMediaResponse.media_list[0];
    var imageUrl = "https://api.twilio.com" + media.uri.replace(/\.json$/, "");

    return { url: imageUrl, sent: new Date(mostRecentMMSMessage.date_sent) };
  }).fail(function(error) {
    throw new Error("Failed to get latest MMS Url: " + error);
  });
};

exports.checkEnvironmentVariables = function() {
  var requiredEnviromentVariables = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TRUSTED_PHONE_NUMBER",
    "TWILIO_PHONE_NUMBER",
    "MMS_SECRET"
  ];

  var missingEnviromentVariables = [];

  requiredEnviromentVariables.forEach(function(environmentVariable) {
    if (!process.env[environmentVariable]) {
      missingEnviromentVariables.push(environmentVariable);
    }
  });

  if (missingEnviromentVariables.length == 0) {
    return;
  } else if (missingEnviromentVariables.length == 1) {
    throw new Error("Environment variable " + missingEnviromentVariables[0] + " is required but missing");
  } else {
    var missingVariablesList = missingEnviromentVariables.map(function(environmentVariable) {
      return "\t" + environmentVariable;
    }).join("\n");
    throw new Error("The following environment variables are required but not provided:\n"
      + missingVariablesList);
  }
}

exports.downloadFile = function(fileUrl, pathToWrite) {
  return new Promise(function(resolve, reject) {
    replay(request(fileUrl))
      .on("error", function(err) {
        reject(err);
      })
      .pipe(fs.createWriteStream(pathToWrite))
      .on("replay", function(replays) {
        debug("Failed to download %s, try #%d", fileUrl, replays);
      })
      .on("error", function (err) {
        reject(err);
      })
      .on("close", function () {
        resolve();
      });
  });
}

exports.createServer = function(twilioMessageValidator) {
  return new Promise(function(resolve, reject) {
    exports.checkEnvironmentVariables();

    exports.updateLatestMMS().then(function() {
      debug("Defining express server");
      var port = 10080;

      var app = express();
      app
        .set("views", __dirname + "/views")
        .set('view engine', 'jade')
        .use("/images", express.static("images"))
        .use(bodyParser.urlencoded({ extended: true }));

      app.get('/', function(req, res) {
        var hoursSinceLastUpdate = moment(new Date()).diff(moment(store["mmsSentDate"]), 'hours');
        var description = exports.getDescriptionFromHours(hoursSinceLastUpdate);
        var timespan = moment(store["mmsSentDate"]).fromNow();
        res.render('index', { timespan: timespan, description: description });
      });

      app.post("/twilio", function(req, res) {
        debug("Received POST to /twilio");
        var validTwilioRequest = twilioMessageValidator(req);
        if (validTwilioRequest) {
          debug("Valid twilio request!");
          exports.updateLatestMMS().done(function(isWebsiteUpdated) {
            if (isWebsiteUpdated) {
              writeSmsResponse(res, "Updated isalecaliveintaiwan.com");
            }
          });
        } else {
          debug("Invalid twilio request!");
          res.sendStatus(403);
          res.end();
        }
      });

      resolve(app);
    }).done();
  });
};

exports.getDescriptionFromHours = function(hours) {
  var range;
  if (hours < 4) {
    range = "0-4";
  } else if (hours < 24) {
    range = "4-24";
  } else if (hours < 48) {
    range = "24-48";
  } else if (hours < 72) {
    range = "48-72";
  } else {
    range = "72+";
  }

  if (range === store["lastRange"]) {
    return store["lastDescription"];
  } else {
    var rangeDescriptions = descriptions[range];
    var randomItem = rangeDescriptions[Math.floor(Math.random()*rangeDescriptions.length)];
    store["lastRange"] = range;
    store["lastDescription"] = randomItem;
    return randomItem;
  }
}

exports.updateLatestMMS = function() {
  debug("(1/3) Getting latest MMS");
  var image;
  return exports.getLatestMms().then(function(latestImage) {
    image = latestImage;

    if (image.url === store["lastImageSaved"]) {
      debug("(done) Skipping download, %s has already been saved", image.url);
      return false;
    } else {
      debug("(2/3) Downloading latest MMS from %s", image.url);
      store["mmsSentDate"] = image.sent;
      return exports.downloadFile(image.url, "images/latest.jpg").then(function() {
        debug("(3/3) Creating thumbnail");
        return exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
      }).then(function() {
        store["lastImageSaved"] = image.url;
        return true;
      });
    }
  });
}

exports.createThumbnail = function(inputFile, outputFile) {
  return new Promise(function(resolve, reject) {
    lwip.open(inputFile, function(err, image) {
      if (err) {
        reject(err);
      }

      var scale = 640 / Math.max(image.width(), image.height());

      image.batch()
        .scale(scale)
        .writeFile(outputFile, function(err) {
          if (err) {
            reject(err);
          }
          resolve();
        });
    });
  });
}

function writeSmsResponse(res, message) {
  var resp = new twilio.TwimlResponse();
  resp.sms(message);

  res.writeHead(200, {"Content-Type": "text/xml; charset=utf-8"});
  res.write(resp.toString());
  res.end();
}

function setReminderTimer() {
  later.date.localTime();
  var schedule = later.parse.text('every 2 hours after 8:00 am');
  later.setInterval(sendReminderIfNecessary, schedule);
}

function setUpdateTimer() {
  later.date.localTime();
  var schedule = later.parse.recur().every(2).hour();
  later.setInterval(exports.updateLatestMMS, schedule);
}

function sendReminderIfNecessary() {
  debug("Checking reminder timer");
  var lastSentDate = store["mmsSentDate"];
  var hoursSinceLastUpdate = moment(new Date()).diff(moment(lastSentDate), 'hours');
  debug("Hours since last update:", hoursSinceLastUpdate);
  if (hoursSinceLastUpdate >= 4) {
    debug("hoursSinceLastUpdate: %d, sending a reminder text", hoursSinceLastUpdate);
    var client = exports.getTwilioClient();
    client.sms.messages.post({
      to: process.env.TRUSTED_PHONE_NUMBER,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: "It's been " + hoursSinceLastUpdate + " hours since last update"
    }, function(err, text) {
      if (err) {
        debug("Error sending SMS reminder", err);
      }
    });
  }
}

if (require.main === module) {
  var twilioMessageValidator = function(req) {
    return twilio.validateExpressRequest(req, process.env.TWILIO_AUTH_TOKEN);
  }

  debug("Starting server...");
  exports.createServer(twilioMessageValidator).then(function(app) {
    setReminderTimer();
    setUpdateTimer();
    var port = process.env.PORT || 10080;
    app.listen(port, function() {
      debug("Listening on http://127.0.0.1:%d", port);
    });
  }).done();
}

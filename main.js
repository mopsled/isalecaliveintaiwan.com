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
    debug = require("debug")("iaait.com")
    lwip = require("lwip");

var client;
exports.getTwilioClient = function() {
  if (client) {
    return client;
  }

  client = new twilio.RestClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
};

exports.getLatestMmsImageUrl = function() {
  var client = exports.getTwilioClient();

  return client.messages.get({from: process.env.TRUSTED_PHONE_NUMBER}).then(function(allMessagesResponse) {
    if (!allMessagesResponse) {
      throw new Error("Couldn't find any messages from " + process.env.TRUSTED_PHONE_NUMBER);
    }

    var mostRecentMMSMessage;
    for (var i = 0; i < allMessagesResponse.messages.length; i++) {
      var message = allMessagesResponse.messages[i];
      if (message.num_media == "1") {
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

    return imageUrl;
  }).fail(function(error) {
    debug("Failed to get latest MMS Url:", error);
  });
};

exports.checkEnvironmentVariables = function() {
  var requiredEnviromentVariables = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TRUSTED_PHONE_NUMBER"
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

    debug("(1/4) Getting latest MMS");
    exports.getLatestMmsImageUrl().then(function(imageUrl) {
      debug("(2/4) Downloading latest MMS from %s", imageUrl);
      return exports.downloadFile(imageUrl, "images/latest.jpg");
    }).then(function() {
      debug("(3/4) Creating thumbnail");
      return exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
    }).then(function() {
      debug("(4/4) Defining server")
      var port = 10080;

      var app = express();
      app.use(express.static("static"));
      app.use("/images", express.static("images"));
      app.use(bodyParser.urlencoded({ extended: true }));

      app.post("/twilio", function(req, res) {
        debug("Received POST to /twilio");
        var validTwilioRequest = twilioMessageValidator(req);
        if (validTwilioRequest) {
          debug("Valid twilio request!");
          writeSmsResponse(res, "Updated isalecaliveintaiwan.com");
          exports.getLatestMmsImageUrl().then(function(imageUrl) {
            return exports.downloadFile(imageUrl, "images/latest.jpg");
          }).then(function() {
            return exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
          }).done();
        } else {
          debug("Invalid twilio request!");
          res.sendStatus(403);
          res.end();
        }
      });

      resolve(app);
    });
  });
};

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

if (require.main === module) {
  var twilioMessageValidator = function(req) {
    return twilio.validateExpressRequest(req, process.env.TWILIO_AUTH_TOKEN);
  }

  debug("Starting server...");
  exports.createServer(twilioMessageValidator).then(function(app) {
    var port = process.env.PORT || 10080;
    app.listen(port, function() {
      debug("Listening on http://127.0.0.1:%d", port);
    });
  }).done();
}

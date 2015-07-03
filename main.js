var express = require("express"),
    url = require("url"),
    request = require("request"),
    fs = require("fs"),
    twilio = require("twilio"),
    util = require("util"),
    qs = require("querystring"),
    Q = require("q"),
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
    var mostRecentMMSMessage;
    for (var i = 0; i != allMessagesResponse.end; i++) {
      var message = allMessagesResponse.messages[i];
      if (message.from == process.env.TRUSTED_PHONE_NUMBER && message.num_media == "1") {
        mostRecentMMSMessage = message;
        break;
      }
    }

    if (!mostRecentMMSMessage) {
      throw { message: "Couldn't find a most recent SMS message" };
    }

    return client.messages(mostRecentMMSMessage.sid).media.get();
  }).then(function(allMediaResponse) {
    if (!allMediaResponse.media_list || !allMediaResponse.media_list[0].sid) {
      throw { message: "Couldn't find a media sid for media that was indended to have an attachment" };
    }

    var media = allMediaResponse.media_list[0];
    var imageUrl = "https://api.twilio.com" + media.uri.replace(/\.json$/, "");
    return imageUrl;
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

function startServer() {
  exports.checkEnvironmentVariables();

  exports.manuallyUpdateLatestImage(function(err) {
    if (err) {
      console.log("Couldn't update image to latest: " + err);
    }
  }).done(function(imageUrl) {
    console.log("Manually refreshing latest image with %s", imageUrl);

    var req = request(imageUrl).pipe(fs.createWriteStream("images/latest.jpg"));
    req.on("finish", function () {
      exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg").then(function() {
        var port = 10080;

        var app = express();
        app.use(express.static('static'));
        app.use('/images', express.static('images'));

        app.listen(port, function() {
          console.log("Listening on http://127.0.0.1:%d", port);
        });
      });
    });
  });
};

exports.createThumbnail = function(inputFile, outputFile) {
  var deferred = Q.defer();

  lwip.open(inputFile, function(err, image) {
    if (err) {
      deferred.reject(err);
    }

    var scale = 640 / Math.max(image.width(), image.height());

    image.batch()
      .scale(scale)
      .writeFile(outputFile, function(err) {
        if (err) {
          deferred.reject(err);
        }
        deferred.resolve();
      });
  });

  return deferred.promise;
}

exports.twilioRequestDelegate = function(req, res) {
  var body = "";
  req.on("data", function(chunk) {
    body += chunk;
  });
  req.on("end", function() {
    var messageJson = qs.parse(body);
    exports.handleNewTwilioMessage(messageJson, res);
  }).on("error", function(e) {
    console.log("Got error: " + e.message);
  });
};

exports.handleNewTwilioMessage = function(messageJson, res) {
  exports.validateMessage(messageJson).then(function(valid) {
    if (valid) {
      console.log("Validated MMS, writing %s to file", messageJson.MediaUrl0);
      var req = request(messageJson.MediaUrl0).pipe(fs.createWriteStream("latest.jpg"));
      req.on("finish", function () {
        exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
      });
      return writeSmsResponse(res, "Uploaded MMS");
    }
  }).fail(function(error) {
    console.log("Couldn't validate MMS: " + err);
    return writeSmsResponse(res, "IsAlecAliveInTaiwan can't validate this MMS");
  });
};

exports.validateMessage = function(message) {
  if (message.From != process.env.TRUSTED_PHONE_NUMBER) {
    return Q.fcall(function() {
      throw new Error("Message not from the correct phone number");
    });
  }
  if (message.NumMedia != "1") {
    return Q.fcall(function() {
      throw new Error("Message does not have exactly one media attachment");
    });
  }
  if (!message.MessageSid) {
    return Q.fcall(function() {
      throw new Error("Message does not have a MessageSid");
    });
  }

  var client = exports.getTwilioClient()

  return client.messages(message.MessageSid).get().then(function(message) {
    if (!message.date_created) {
      throw new Error("date_created missing from message");
    }

    var dateSent = new Date(message.date_created);
    var rightNow = new Date();
    var minutesSinceSent = (rightNow - dateSent) / (1000 * 60 * 5);
    if (minutesSinceSent > 5) {
      throw new Error(util.format("Message is too old (%d minutes)", minutesSinceSent));
    }

    return true;
  });
};

function writeSmsResponse(res, message) {
  var resp = new twilio.TwimlResponse();
  resp.sms(message);

  res.writeHead(200, {"Content-Type": "text/xml; charset=utf-8"});
  res.write(resp.toString());
  res.end();
}

if (require.main === module) {
  startServer();
}

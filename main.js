var express = require("express"),
    url = require("url"),
    request = require("request"),
    bodyParser = require("body-parser"),
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
      if (message.num_media == "1") {
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

exports.downloadFile = function(fileUrl, pathToWrite) {
  var deferred = Q.defer();

  var req = request(fileUrl).pipe(fs.createWriteStream(pathToWrite));
  req.on("finish", function () {
    deferred.resolve();
  });

  return deferred.promise;
}

exports.createServer = function() {
  var deferred = Q.defer();

  exports.checkEnvironmentVariables();

  exports.getLatestMmsImageUrl().then(function(imageUrl) {
    return exports.downloadFile(imageUrl, "images/latest.jpg");
  }).then(function() {
    return exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
  }).done(function() {
    var port = 10080;

    var app = express();
    app.use(express.static("static"));
    app.use("/images", express.static("images"));
    app.use(bodyParser.urlencoded({ extended: true }));

    app.post("/twilio", function(req, res) {
      var validTwilioRequest = twilio.validateExpressRequest(req, process.env.TWILIO_AUTH_TOKEN);
      if (validTwilioRequest) {
        exports.getLatestMmsImageUrl().then(function(imageUrl) {
          return exports.downloadFile(imageUrl, "images/latest.jpg");
        }).then(function() {
          return exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
        })
      }
    });

    deferred.resolve(app);
  });

  return deferred.promise;
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

function writeSmsResponse(res, message) {
  var resp = new twilio.TwimlResponse();
  resp.sms(message);

  res.writeHead(200, {"Content-Type": "text/xml; charset=utf-8"});
  res.write(resp.toString());
  res.end();
}

if (require.main === module) {
  exports.createServer().then(function(app) {
    app.listen(10080, function() {
      console.log("Listening on http://127.0.0.1:10080", port);
    });
  });
}

var express = require("express"),
    url = require("url"),
    http = require("http"),
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
    return Q(client);
  }

  client = new twilio.RestClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
};

exports.manuallyUpdateLatestImage = function(done) {
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

    imageUrl = "https://api.twilio.com" + media.uri.replace(/\.json$/, "");

    console.log("Manually refreshing latest image with %s", imageUrl);

    var req = request(imageUrl).pipe(fs.createWriteStream("images/latest.jpg"));
    req.on("finish", function () {
      exports.createThumbnail("images/latest.jpg", "images/latest-small.jpg");
    });
  })
};

exports.getPathDelegate = function(req) {
  var uri = url.parse(req.url);

  if (uri.pathname == "/") {
    return exports.indexRequestDelegate;
  } else if (uri.pathname.indexOf("/twilio") === 0) {
    return exports.twilioRequestDelegate;
  } else if (uri.pathname === "/images/latest.jpg") {
    return exports.imageRequestDelegate;
  } else if (uri.pathname === "/images/latest-small.jpg") {
    return exports.thumbImageRequestDelegate;
  } else {
    return exports.fileNotFoundDelegate;
  }
};

exports.checkConfiguration = function() {
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
  exports.manuallyUpdateLatestImage(function(err) {
    if (err) {
      console.log("Couldn't update image to latest: " + err);
    }
  });

  var port = 10080;

  http.createServer(function(req, res) {
    var uri = url.parse(req.url);
    console.log("Got reqest from " + uri.pathname);

    delegate = exports.getPathDelegate(req);
    delegate(req, res);
  }).listen(parseInt(port, 10));
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

exports.indexRequestDelegate = function(req, res) {
  fs.readFile("static/index.html", function (err, data) {
    if (err) {
      return console.log("Error reading index: " + err);
    }
    res.writeHead(200, {"Content-Type": "text/html" });
    res.end(data, "binary");
  });
};

exports.imageRequestDelegate = function(req, res) {
  fs.readFile("images/latest.jpg", function (err, data) {
    if (err) {
      return console.log("Error returning latest image: " + err);
    }
    res.writeHead(200, {"Content-Type": "image/jpeg" });
    res.end(data, "binary");
  });
};

exports.thumbImageRequestDelegate = function(req, res) {
  fs.readFile("images/latest-small.jpg", function (err, data) {
    if (err) {
      return console.log("Error returning thumbnail image: " + err);
    }
    res.writeHead(200, {"Content-Type": "image/jpeg" });
    res.end(data, "binary");
  });
};

exports.fileNotFoundDelegate = function(req, res) {
  res.writeHead(404);
  res.end();
};

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
var assert = require("assert"),
    fs = require("fs")
    validUrl = require("valid-url")
    request = require("supertest")
    main = require("../main.js");

describe("Main", function() {
  describe("#checkEnvironmentVariables", function() {
    it("should not throw normally (indicating environment is setup)", function(done) {
      assert.doesNotThrow(function() {
        main.checkEnvironmentVariables();
      });
      done();
    });

    it("should throw if an enviroment variable is missing", function(done) {
      var accountSid = process.env["TWILIO_ACCOUNT_SID"];
      delete process.env["TWILIO_ACCOUNT_SID"];

      assert.throws(function() {
        main.checkEnvironmentVariables();
      });

      process.env["TWILIO_ACCOUNT_SID"] = accountSid;
      done();
    });

    it("should throw if multiple enviroment variables are missing", function(done) {
      var accountSid = process.env["TWILIO_ACCOUNT_SID"];
      delete process.env["TWILIO_ACCOUNT_SID"];
      var authToken = process.env["TWILIO_AUTH_TOKEN"];
      delete process.env["TWILIO_AUTH_TOKEN"];

      assert.throws(function() {
        main.checkEnvironmentVariables();
      });

      process.env["TWILIO_ACCOUNT_SID"] = accountSid;
      process.env["TWILIO_AUTH_TOKEN"] = authToken;
      done();
    });
  });

  describe("#getTwilioClient", function() {
    it("should return a client", function(done) {
      var client = main.getTwilioClient();

      assert(client);
      done();
    });
  });

  describe("#createThumbnail", function() {
    var inputImage = "test/assets/test-picture.jpg";
    var outputImage = "test/assets/test-thumbnail.jpg";

    before(function(done) {
      // Make sure output file doesn't exist
      try {
        fs.unlinkSync(outputImage);
      } catch(ex) {}

      main.createThumbnail(inputImage, outputImage).then(function() {
        done();
      });
    });

    after(function(done) {
      fs.unlinkSync(outputImage);
      done();
    });

    it("should create an output file", function(done) {
      assert(fs.existsSync(outputImage));
      done();
    });

    it("should create a non-zero sized output file", function(done) {
      var stats = fs.statSync(outputImage);
      assert(stats["size"] > 0);
      done();
    });

    it("should create an image that's smaller than the input", function(done) {
      var inputStats = fs.statSync(inputImage);
      var outputStats = fs.statSync(outputImage);
      assert(outputStats["size"] < inputStats["size"]);
      done();
    });
  });

  describe("#createServer", function() {
    var app;

    before(function(done) {
      this.timeout(10000);
      main.createServer().then(function(server) {
        app = server;
        done();
      }).catch(done);
    });

    it("should return 200 for GET /", function(done) {
      request(app)
        .get("/")
        .expect(200, done);
    });
  });
});

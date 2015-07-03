var assert = require("assert"),
    fs = require("fs")
    validUrl = require("valid-url")
    main = require("../main.js");

describe("Main", function() {
  describe("#checkEnvironmentVariables", function() {
    it("should not throw", function(done) {
      assert.doesNotThrow(function() {
        main.checkEnvironmentVariables();
      });
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

  describe("#getLatestMmsImageUrl", function() {
    it("should return a url", function(done) {
      main.getLatestMmsImageUrl().then(function(mmsImageUrl) {
        assert(validUrl.isUri(mmsImageUrl));
        done();
      });
    });
  });

  describe("#validateMessage", function() {
    it("should not validate an empty message", function(done) {
      var messageJson = {};
      main.validateMessage(messageJson).then(function(valid) {
        assert.fail("Message shouldn't validate");
        done();
      }).fail(function(error) {
        // Message invalid; good
        done();
      });
    });

    it("should not validate a valid-looking message sent from the wrong number", function(done) {
      var messageJson = {
        From: "+12345678910",
        NumMedia: "1",
        MessageSid: "fakeSid123"
      };
      main.validateMessage(messageJson).then(function(valid) {
        assert.fail("Message shouldn't validate");
        done();
      }).fail(function(error) {
        // Message invalid; good
        done();
      });
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
});

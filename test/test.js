var assert = require("assert"),
    main = require("../main.js");

describe("Main", function() {
  describe("#checkConfiguration", function() {
    it("should not throw", function(done) {
      main.checkConfiguration();
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

  describe("#getPathDelegate", function() {
    it("should return the delegate for twilio if the URL starts with '/twilio'", function() {
      var req = {
        "url": "/twilio"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.twilioRequestDelegate);
    });

    it("should return the delegate for the index when the URL is '/'", function() {
      var req = {
        "url": "/"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.indexRequestDelegate);
    });

    it("should return the delegate for images when the URL is '/images/latest.jpg'", function() {
      var req = {
        "url": "/images/latest.jpg"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.imageRequestDelegate);
    });

    it("should return the delegate for images when the URL is '/images/latest-small.jpg'", function() {
      var req = {
        "url": "/images/latest-small.jpg"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.thumbImageRequestDelegate);
    });

    it("should return a 404 for a nonsense page", function() {
      var req = {
        "url": "not-there.html"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.fileNotFoundDelegate);
    });

    it("should return a 404 for a nonsense path", function() {
      var req = {
        "url": "/etc/passwd"
      };
      delegate = main.getPathDelegate(req);
      assert.equal(delegate, main.fileNotFoundDelegate);
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
  })
});

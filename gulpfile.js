var co = require('co');
var gulp = require('gulp');
var karma = require('karma').server;
var rename = require('gulp-rename');
var size = require('gulp-size');
var uglify = require('gulp-uglify');
var util = require('util');

// Defines
var FILENAME_DEV = 'browser-cookies.js';
var FILENAME_MIN = 'browser-cookies.min.js';

// Browsers to run on Sauce Labs (https://saucelabs.com/platforms/)
var customLaunchers = {
  // Mobile
  /*Android_40: {browserName: 'android',           version: '4.0'},
  Android_50: {browserName: 'android',           version: '5'},
  iPhone_4:   {browserName: 'iphone',            version: '4'},
  iPhone_6:   {browserName: 'iphone',            version: '6'},
  iPhone_8:   {browserName: 'iphone',            version: '8'},*/

  // Desktop
  Chrome_26:  {browserName: 'chrome',            version: '26'},
  Chrome_41:  {browserName: 'chrome',            version: '41'},
  IE_07:      {browserName: 'internet explorer', version:  '7'},
  IE_08:      {browserName: 'internet explorer', version:  '8'},
  IE_09:      {browserName: 'internet explorer', version:  '9'},
  IE_10:      {browserName: 'internet explorer', version: '10'},
  IE_11:      {browserName: 'internet explorer', version: '11'},
  Firefox_03: {browserName: 'firefox',           version:  '3'},
  Firefox_36: {browserName: 'firefox',           version: '36'},
  Opera_11:   {browserName: 'opera',             version: '11'},
  Safari_5:   {browserName: 'safari',            version:  '5'},
  Safari_8:   {browserName: 'safari',            version:  '8'}
};

// Base Karma configuration, contains everything needed for a local teste run
// The config is extended by gulp tasks below to add coverage/sauselabs/etc
var karmaConfig = {
  basePath: '',
  frameworks: ['jasmine'],
  files: ['browser-cookies.js', 'test.js'],
  reporters: ['progress', 'spec'],
  port: 9876,
  colors: true,
  autoWatch: false,
  singleRun: true,
  preprocessors: {
    'browser-cookies.js': ['wrap'],
  },
  wrapPreprocessor: {
    template: 'function requireCookies(document, Date, exports) { <%= contents %> }'
  },
  browsers: ['PhantomJS'],
  //logLevel: 'DEBUG',
};

// Function to run Karma on Sauce Labs in batches
// so start 3 jobs -> wait for these to finish -> start another 3 jobs -> etc...
// Using a 'co' function, so asyncronous functions can by yielded synchronous
var runInSeries = function *(config, browsers, done) {
  var parallelJobs = 1;

  var batchTotal = Math.ceil(browsers.length / parallelJobs);
  var batchCurrent = 0;

  while(browsers.length > 0) {
    // Determine the browsers to test in this batch
    config.browsers = [];
    while(browsers.length > 0 && config.browsers.length < parallelJobs) {
      config.browsers.push(browsers.pop());
    }

    console.log(Date.now(), 'Starting batch ' + (batchCurrent + 1) + '/' + batchTotal + ': ', config.browsers.join(', '));

    // Run Karma batch
    yield new Promise(function (resolve, reject) {
      karma.start(config, function () {
        // Resolve using a timeout to allow existing karma session to exit before starting a new session
        setTimeout(function() {resolve();}, 0);
      });
    });

    console.log(Date.now(), 'Finished batch ' + (batchCurrent + 1) + '/' + batchTotal + ': ', config.browsers.join(', '));
    batchCurrent += 1;

    // Increase port number, to prevent conflict with previous Karma session that may still be shutting down
    config = util._extend({}, config);
    config.port += 10;
  }

  done();
};

gulp.task('build', function (done) {
  return gulp.src(FILENAME_DEV)
  .pipe(size({gzip: false, title: FILENAME_DEV + '     size:'}))
  .pipe(uglify())
  .pipe(rename(FILENAME_MIN))
  .pipe(size({gzip: false, title: FILENAME_MIN + ' size:'}))
  .pipe(size({gzip: true,  title: FILENAME_MIN + ' size:'}))
  .pipe(gulp.dest('dist'));
});

// Test run including code coverage and Sauce Labs
// May be run locally or using travis CI
gulp.task('test:full', function (done) {
  // Check whether Sause Labs credentials are configured
  if (!process.env.SAUCE_USERNAME) {
    console.log('SAUCE_USERNAME and SAUSE_ACCESS_KEY must be configured as ENV vars');
    process.exit(1);
  }

  // Copy the Karma config
  var config = util._extend({}, karmaConfig);

  // Stop after the test run has finishsed
  config.singleRun = true;

  // Enable code coverage
  config.reporters.push('coverage');
  config.preprocessors[FILENAME_DEV].push('coverage');
  config.coverageReporter = {
    dir: 'coverage/',
    reporters: [
      {type: 'lcov', subdir: '.' },
      {type: 'cobertura', subdir: '.', file: 'cobertura.xml'}
    ]
  };

  // Determine starttime of the test (used in test title and build numbee).
  var date = new Date();
  var startDate = date.toISOString().slice(0,10).replace(/-/g,"");
  function pad(integer) {return ('0' + integer).slice(-2);}
  var startTime = pad(date.getHours()) +pad(date.getMinutes()) + pad(date.getSeconds());
  var start = startDate + '_' + startTime;

  // Configure Sauce Labs browsers
  for (var launcher in customLaunchers) {
    customLaunchers[launcher].base = 'SauceLabs'; // Use SauceLabs
    customLaunchers[launcher].public = 'public'; // Make results public
    customLaunchers[launcher].tags = [launcher]; // Add browser key as tag

    // If running on TRAVIS use the job number as tunnel-identifier for Sauce Labs
    if (process.env.TRAVIS_JOB_NUMBER !== undefined) {
      customLaunchers[launcher]['tunnel-identifier'] = process.env.TRAVIS_JOB_NUMBER;
      customLaunchers[launcher].build                = process.env.TRAVIS_BUILD_NUMBER + '_' + START;
    } else {
      customLaunchers[launcher]['tunnel-identifier'] = start;
    }
  }

  // Enable Sauce Labs
  config.reporters.push('saucelabs');
  config.sauceLabs = {
    testName: start,
    };
  config.customLaunchers = customLaunchers;
  config.captureTimeout = 300 * 1000;
  config.browserNoActivityTimeout = 300 * 1000;
  config.browserDisconnectTimeout = 15 * 1000;
  config.browserDisconnectTolerance = 2;
  config.browserNoActivityTimeout = 300 * 1000;
  config.background = true;

  //config.browsers = Object.keys(customLaunchers);
  //karma.start(config, done)

  // Run Karma (on Sauce Labs) in batches
  console.log('Starting karma session:', config.sauceLabs.testName);
  co(runInSeries(config, Object.keys(customLaunchers).sort(), done));
});

// Execute tests on local system
gulp.task('test:local', function (done) {
  // Copy the Karma config
  var config = util._extend({}, karmaConfig);

  // Stop after the test run has finishsed
  config.singleRun = true; // Run only once

  // Run Karma
  karma.start(config, done);
});

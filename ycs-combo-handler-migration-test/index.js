#!/usr/bin/env node

var NUM_MODULES_PER_URL = 2;
var NUM_URLS = 3;

var FORMAT_TO_APPEND = {
    debug: '-debug',
    raw:   '',
    min:   '-min'
};

var lib = {
    url:    require('url'),
    path:   require('path'),
    http:   require('http'),
    exec:   require('child_process').exec
};

var Stats   = require('fast-stats').Stats;
var async   = require('async');
var glob    = require('glob');

// Formats a module build path given a name, format, type, and version.
function formatComboPath (name, config) {
    var buildDir = config.includeBuildDir ? '/build/' : '/',
        format = FORMAT_TO_APPEND[config.format],
        filename = name + format + '.' + config.type;
    return config.version + buildDir + name + '/' + filename;
}

// Inspects the build.json files in a yui3 repo to get all module names.
function getModules (callback) {
    console.log('getModules...');
    var seen    = {},
        jsMods  = [],
        cssMods = [];

    glob('src/*/build.json', function (err, files) {
        if (!files.length) {
            return callback(new Error('This version of YUI has no build.json files'));
        }
        files.forEach(function (file) {
            var builds = require(lib.path.join(
                process.cwd(), file
            )).builds;

            Object.keys(builds).forEach(function (name) {
                // console/build.json has "skinnable"
                if (seen[name] || name === 'skinnable') {
                    return;
                }
                seen[name] = true;

                if (builds[name].jsfiles) {
                    jsMods.push(name);
                } else if (builds[name].cssfiles) {
                    cssMods.push(name);
                } else {
                    console.warn(name + ' is neither a js nor css file!?');
                }
            });
        });
        return callback(null, {
            js: jsMods,
            css: cssMods
        });
    });
}

function getComboUrls (results, callback) {
    console.log('getComboUrls...');
    results.combos = [];

    ['js', 'css'].forEach(function (type) {
        var modules = results[type],
            paths = [],
            len,
            i;

        for (i = 0, len = modules.length; i < len; i += 1) {
            paths.push(formatComboPath(modules[i], {
                includeBuildDir: false,
                type: type,
                format: 'raw',
                version: '3.10.0'
            }));
        }

        results.combos.push({
            host: 'yui.yahooapis.com',
            url: 'http://yui.yahooapis.com/combo?' + paths.join('&'),
            type: type,
            format: 'raw',
            paths: paths.slice(0)
        });
        results.combos.push({
            host: 'c3.ycs.gq1.yahoo.com',
            url: 'http://c3.ycs.gq1.yahoo.com/combo?' + paths.join('&'),
            type: type,
            format: 'raw',
            paths: paths.slice(0)
        });
    });

    callback(null, results);
}

function getRandomComboUrls (results, callback) {
    console.log('getRandomComboUrls...');
    var modules = results.js,
        combos  = [],
        paths   = [],
        randomIndex,
        i,
        j;

    for (i = 0; i < NUM_URLS; i += 1) {
        for (j = 0; j < NUM_MODULES_PER_URL; j += 1) {
            randomIndex = Math.floor((Math.random() * 100)) % modules.length;
            paths.push(formatComboPath(modules[randomIndex], {
                includeBuildDir: false,
                type: 'js',
                format: 'raw',
                version: '3.10.0'
            }));
        }

        combos.push('http://yui.yahooapis.com/combo?' + paths.join('&'));
        combos.push('http://c3.ycs.gq1.yahoo.com/combo?' + paths.join('&'));

        paths = [];
    }

    callback(null, {
        combos: combos
    });
}

function testComboUrls (results, callback) {
    console.log('testComboUrls...');
    var transactions = { success: [], failure: [] },
        jobs = [],
        total;

    results.combos.forEach(function (combo) {
        jobs.push(function (cb) {
            var options = lib.url.parse(combo),
                start,
                end;

            // Slower, but we don't have to worry about connection pooling.
            options.agent = false;

            options.headers = {
                Host: 'yui.yahooapis.com'
            };

            start = new Date();
            lib.http.get(options, function (res) {
                end = new Date();

                var data = {
                    req: options,
                    res: {
                        status: res.statusCode,
                        latency: end - start,
                        headers: res.headers
                    }
                };

                if (res.statusCode === 200) {
                    transactions.success.push(data);
                } else {
                    transactions.failure.push(data);
                }

                console.log('[testComboUrls]', new Date().getTime(), res.statusCode);

                cb();
            }).on('error', function (err) {
                console.error(err);
                return cb(err);
            });
        });
    });

    async.series(jobs, function () {
        var success = transactions.success,
            failure = transactions.failure,
            total   = success.length + failure.length;

        if (total === results.combos.length) {
            console.log(JSON.stringify(transactions, null, 4));

            console.log('[testComboUrls]', 'Total:' + transactions.success.length + transactions.failure.length);
            console.log('[testComboUrls]', 'Success: ' + transactions.success.length);
            console.log('[testComboUrls]', 'Failure: ' + transactions.failure.length);

            return callback(null, transactions);
        }
    });
}

function descriptiveStatistics (results, callback) {
    var latency = [],
        stats;

    results.success.forEach(function (transaction) {
        if (transaction.req.host === 'c3.ycs.gq1.yahoo.com') {
            latency.push(transaction.res.latency);
        }
    });

    stats = new Stats({ bucket_precision: 100 }).push(latency);
    console.log('[testComboUrls]', JSON.stringify({
        geometric_mean: stats.gmean(),
        median: stats.median(),
        distribution: stats.distribution()
    }, null, 4));

    callback();
}

async.waterfall([
    getModules,
//    getComboUrls,
    getRandomComboUrls,
    testComboUrls,
    descriptiveStatistics
], function (err) {
    if (err) {
        console.error(err);
        return process.exit(1);
    }
});

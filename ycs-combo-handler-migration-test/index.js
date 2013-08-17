#!/usr/bin/env node

var NUM_MODULES = 3;

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
    results.combo = [];

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

        results.combo.push({
            host: 'yui.yahooapis.com',
            url: 'http://yui.yahooapis.com/combo?' + paths.join('&'),
            type: type,
            format: 'raw',
            paths: paths.slice(0)
        });
        results.combo.push({
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
    var modules = results.js,
        combos  = [],
        paths   = [],
        randomIndex,
        i;

    for (i = 0; i < NUM_MODULES; i += 1) {
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

    callback(null, {
        combo: combos
    });
}

function testComboUrls (results, callback) {
    var transactions    = { success: [], failure: [] },
        urls            = [],
        total,
        start,
        end,
        len,
        i;

    for (i = 0, len = 3; i < len; i += 1) {
        urls = [].concat(urls, results.combo);
    }

    urls.forEach(function (combo) {
        var options = lib.url.parse(combo);

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

            total = transactions.success.length + transactions.failure.length;
            if (total === urls.length) {
                console.log('[testComboUrls]', 'Total:' + total);
                console.log('[testComboUrls]', 'Success: ' + transactions.success.length);
                console.log('[testComboUrls]', 'Failure: ' + transactions.failure.length);

                console.log(JSON.stringify(transactions, null, 4));

                return callback();
            }
        }).on('error', function (err) {
            console.error(err);
            return callback(err);
        });
    });
}

async.waterfall([
    getModules,
//    getComboUrls,
    getRandomComboUrls,
    testComboUrls
], function (err) {
    if (err) {
        console.error(err);
        return process.exit(1);
    }
});

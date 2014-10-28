#!/usr/bin/env node

var zip = require('../lib/bestzip.js');

var argv = require('yargs')
    .usage("\nUsage: bestzip destination.zip source/")
    .demand(2)
    .argv._;

var dest = argv[0];
var source = argv[1];

console.log('Writing %s to %s...', source, dest);
zip(dest, source, function(err) {
    if (err) {
        console.error(err);
        return process.exit(1);
    }
    console.log('zipped!');
});
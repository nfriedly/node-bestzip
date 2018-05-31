# bestzip

[![Linux and MacOS build status](https://travis-ci.org/nfriedly/node-bestzip.svg?branch=master)](https://travis-ci.org/nfriedly/node-bestzip)
[![Windows build status](https://ci.appveyor.com/api/projects/status/6gk3igwk2l85djnn?svg=true)](https://ci.appveyor.com/project/nfriedly/node-bestzip)

This module provides a `bestzip` command that calls the native `zip` command if available and otherwise falls back to a
Node.js implementation.

The native `zip` method on OS X is both faster and ~ twice as efficient as the Node.js version, while Windows has no
native `zip` command.


## Global command line usage

    npm install -g bestzip
    bestzip destination.zip source/ [other sources...]

## Command line usage within `package.json` scripts

    npm install --save bestzip

package.json:

```javascript
{
    //...
    "scripts": {
        "build" "...",
        "zip": "bestzip bundle.zip source/*",
        "upload": "....",
        "deploy": "npm run build && npm run zip && npm run upload"
    }
}
```

## Pragmatic usage from within Node.js

```javascript
var zip = require('bestzip');

var files = [];

zip('./destination.zip', ['source/', 'other_soure_file.js'], function(err) {
    if  (err) {
        console.error(err.stack);
        process.exit(1);
    } else {
        console.log('all done!');
    }
});
```

## Todo

* Automated deployment
* Fix bug when source contains `../`
* Test if using a vbscript or whatever on Windows results in significantly better performance.

## MIT License

Copyright (c) 2014 Nathan Friedly - http://nfriedly.com/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

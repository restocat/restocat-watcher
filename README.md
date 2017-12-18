# Restocat Watcher

[![Build Status](https://travis-ci.org/restocat/restocat-watcher.svg?branch=master)](https://travis-ci.org/restocat/restocat-watcher)


## Installation


`npm i restocat-watcher`


## How to use


In `server.js` file


```javascript
    const Restocat = require('restocat');
    const Watcher = require('restocat-watcher');
    const rest = new Restocat();
    const server = rest.createServer();

    const watcher = new Watcher(rest.locator);

    server.listen(3000)
      .then(() => logger.info('Restocat listen on 3000 port'))
      .then(() => {
        if (process.env.NODE_ENV !== 'production') {
            watcher.watchCollections();
        }
      })
      .catch(reason => console.error(reason));
```

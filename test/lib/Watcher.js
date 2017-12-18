const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const EventEmitter = require('events').EventEmitter;
const ServiceLocator = require('catberry-locator');
const utils = require('../utils');
const CollectionsFinder = require('restocat/lib/finders/CollectionsFinder');
const CollectionsLoader = require('restocat/lib/loaders/CollectionsLoader');
const Watcher = require('../../lib/Watcher');

/* eslint brace-style:0 */
const RequestRouter = class {init() { return Promise.resolve(); }};

const copy = fs.copy;
const remove = fs.remove;
const writeFile = fs.writeFile;

/* eslint prefer-arrow-callback:0 */
/* eslint max-nested-callbacks:0 */
/* eslint require-jsdoc:0 */
/* eslint no-sync: 0 */
/* eslint no-underscore-dangle: 0 */
describe('lib/Watcher', () => {

  let tmpFolder;

  afterEach(async () => {
    if (tmpFolder) {
      try {
        remove(tmpFolder);
      } catch (e) {}
    }
  });

  it('#initialization', async () => {
    const locator = new ServiceLocator();
    locator.registerInstance('serviceLocator', locator);
    locator.registerInstance('events', new EventEmitter());
    locator.register('collectionsLoader', CollectionsLoader, true);
    locator.register('collectionsFinder', CollectionsFinder, true);
    locator.register('requestRouter', RequestRouter, true);
    locator.registerInstance('config', {
      isRelease: false,
      collectionsGlob: [
        'test/cases/watch/**/test-collection.json'
      ]
    });

    locator.resolve('collectionsLoader').load();

    const events = locator.resolve('events');
    const promise = new Promise((resolve, reject) => {
      events.on('error', reject);
      events.on('readyWatchers', () => resolve());
    });

    const watcher = new Watcher(locator);
    const watchers = await watcher.watchCollections();

    await promise;

    watchers.forEach(watcher => watcher.close());
  });

  describe('#watchCollectionJsonFiles', () => {
    let locator;

    beforeEach(() => {
      locator = new ServiceLocator();
      locator.registerInstance('serviceLocator', locator);
      locator.registerInstance('events', new EventEmitter());
      locator.register('collectionsFinder', CollectionsFinder, true);
      locator.register('requestRouter', RequestRouter, true);
      locator.register('watcher', Watcher, true);
    });

    /**
     * Watcher emit unlink, add
     */
    it('should recreate collection after change collection.json', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');

      locator.registerInstance('config', {
        isRelease: true,
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      let collections;

      const watcher = locator.resolve('watcher');
      const finder = locator.resolve('collectionsFinder');
      const promiseUnlink = new Promise(resolve => watcher.on('unlink', resolve));
      const promiseAdd = new Promise(resolve => {
        watcher.on('add', collection => {
          assert.equal(collection.name, collections[Object.keys(collections)[0]].name);
          resolve();
        });
      });

      await copy(caseRoot, tmpPath);

      collections = await finder.find();

      assert.equal(Object.keys(collections).length, 1);

      const jsonWatcher = await watcher.watchCollectionJsonFiles();
      const collectionJsonContent = JSON.parse(await fs.readFile(alreadyPath));

      collectionJsonContent.timestamp = Date.now();

      await Promise.all([writeFile(alreadyPath, JSON.stringify(collectionJsonContent)), promiseAdd, promiseUnlink]);
      await jsonWatcher.close();
    });

    /**
     * Watcher emit unlink, add
     */
    it('should reinitialization routes after change collection.json', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');
      let reinit = false;
      const RequestRouter = class {init() { reinit = true; return Promise.resolve(); }};

      locator.register('requestRouter', RequestRouter, true);
      locator.registerInstance('config', {
        isRelease: true,
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');
      const promiseUnlink = new Promise(resolve => watcher.on('unlink', resolve));
      const promiseAdd = new Promise(resolve => {
        watcher.on('add', () => {
          assert.equal(reinit, true);
          resolve();
        });
      });

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchCollectionJsonFiles();
        })
        .then(jsonWatcher => {
          const collectionJsonContent = JSON.parse(fs.readFileSync(alreadyPath));
          collectionJsonContent.timestamp = Date.now();

          return Promise
            .all([writeFile(alreadyPath, JSON.stringify(collectionJsonContent)), promiseAdd, promiseUnlink])
            .then(() => jsonWatcher.close());
        });
    });

    /**
     * Watcher emit add
     */
    it('should add new collection', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const anotherCollection = 'test/cases/collections/test1/test2';
      const fullPathNew = path.join(tmpPath, 'newCollection');

      locator.registerInstance('config', {
        isRelease: true,
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');
      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchCollectionJsonFiles();
        })
        .then(jsonWatcher => {
          const promise = new Promise(resolve => {
            jsonWatcher.once('add', () => {
              jsonWatcher.close();

              resolve(finder.find());
            });
          });

          return Promise.all([copy(anotherCollection, fullPathNew), promise]);
        })
        .then(data => assert.equal(Object.keys(data[1]).length, 2));
    });

    /**
     * Watcher emit warn to global event bus
     */
    it('skip collection with equal name', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const anotherCollection = 'test/cases/collections/test1/test2';
      const fullPathNew = path.join(tmpPath, 'newCollection');
      const fullPathNewDuplicate = path.join(tmpPath, 'newCollectionDuplicate');

      locator.registerInstance('config', {
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchCollectionJsonFiles();
        })
        .then(jsonWatcher => {
          const events = locator.resolve('events');
          let promise = new Promise(resolve => {
            events.on('warn', message => {
              assert.notEqual(-1, message.indexOf('skipping'));

              jsonWatcher.close();

              resolve();
            });
          });

          promise = promise
            .then(() => finder.find().then(collections => assert.equal(Object.keys(collections).length, 2)));

          return Promise.all([
            copy(anotherCollection, fullPathNew),
            copy(anotherCollection, fullPathNewDuplicate),
            promise
          ]);

        })
        .catch(reason => {
          fs.removeSync(fullPathNew);
          fs.removeSync(fullPathNewDuplicate);

          throw reason;
        });
    });

    it('skip collection with invalid collection.json', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');
      const events = locator.resolve('events');

      locator.registerInstance('config', {
        isRelease: true,
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');
      const promiseError = new Promise((resolve, reject) => {
        events.on('error', error => {
          try {
            assert.notEqual(String(error).indexOf('test-collection.json: Unexpected token \''), -1);
          } catch (e) {
            reject(e);
          }

          resolve();
        });
      });

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchCollectionJsonFiles();
        })
        .then(jsonWatcher => {
          let collectionJsonContent = fs.readFileSync(alreadyPath);
          collectionJsonContent = collectionJsonContent.toString().replace(/\"/, '\'');

          return Promise
            .all([writeFile(alreadyPath, collectionJsonContent), promiseError])
            .then(() => jsonWatcher.close());
        });
    });
  });

  describe('#watchLogicFiles', () => {
    let locator;

    beforeEach(() => {
      locator = new ServiceLocator();
      locator.registerInstance('serviceLocator', locator);
      locator.registerInstance('events', new EventEmitter());
      locator.register('collectionsFinder', CollectionsFinder, true);
      locator.register('requestRouter', RequestRouter, true);
      locator.register('watcher', Watcher, true);
    });

    it('should emit "change" collection after change "collection/index.js and re-init Router"', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'index.js');
      let RequestRouter = null;

      const reinitPromise = new Promise(resolve => {
        RequestRouter = class {init() { resolve(); return Promise.resolve(); }};
      });

      locator.register('requestRouter', RequestRouter, true);
      locator.registerInstance('config', {
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchLogicFiles();
        })
        .then(logicWatcher => {
          const promise = new Promise((resolve, reject) => {
            logicWatcher.on('error', reject);
            watcher.on('change', data => {
              logicWatcher.close();
              assert.equal(data.collection.name, collections[Object.keys(collections)[0]].name);

              const Logic = require(path.join(process.cwd(), alreadyPath));
              const logic = new Logic();

              assert.equal(logic.foo(), 'foo');

              resolve();
            });
          });

          let collectionJsonContent = fs.readFileSync(alreadyPath).toString();
          collectionJsonContent = collectionJsonContent.replace(/blablabla/, 'foo');

          return Promise.all([writeFile(alreadyPath, collectionJsonContent), promise, reinitPromise]);
        });
    });

    it('should emit "change" collection after add file to collection', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const anotherPath = path.join(tmpPath, 'already', 'AnotherForAlready.js');
      const copyPath = path.join(tmpPath, 'customs', 'AnotherForAlready.js');

      locator.registerInstance('config', {
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => utils.wait(200))
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchLogicFiles();
        })
        .then(logicWatcher => {
          const promise = new Promise((resolve, reject) => {
            logicWatcher.on('error', reject);
            watcher.on('change', data => {
              logicWatcher.close();
              utils.wait(20)
                .then(() => {
                  assert.equal(data.filename, anotherPath);
                  resolve();
                })
                .catch(reject);
            });
          });

          return Promise.all([copy(copyPath, anotherPath), promise]);
        });
    });

    it('should emit "unlink" collection after remove logic file', () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'index.js');

      locator.registerInstance('config', {
        collectionsGlob: [
          `${tmpPath}/**/test-collection.json`
        ]
      });

      const finder = locator.resolve('collectionsFinder');
      const watcher = locator.resolve('watcher');

      let collections;

      return copy(caseRoot, tmpPath)
        .then(() => finder.find())
        .then(found => {
          collections = found;

          assert.equal(Object.keys(collections).length, 1);

          return watcher.watchLogicFiles();
        })
        .then(logicWatcher => {
          let promise = new Promise((resolve, reject) => {
            logicWatcher.on('error', reject);

            watcher.on('unlink', () => {
              logicWatcher.close();
              resolve();
            });
          });

          promise = promise
            .then(() => finder.find())
            .then(found => assert.equal(Object.keys(collections).length, 0));

          return Promise.all([remove(alreadyPath), promise]);
        });
    });
  });

  describe('#watchCollections', () => {
    let locator;

    beforeEach(() => {
      locator = new ServiceLocator();
      locator.registerInstance('serviceLocator', locator);
      locator.registerInstance('events', new EventEmitter());
      locator.register('collectionsFinder', CollectionsFinder, true);
      locator.register('collectionsLoader', CollectionsLoader, true);
      locator.register('requestRouter', RequestRouter, true);
      locator.register('watcher', Watcher, true);
    });

    it('should start watch', async () => {
      const caseRoot = 'test/cases/watch';

      locator.registerInstance('config', {
        collectionsGlob: [
          `${caseRoot}/**/test-collection.json`
        ]
      });

      const events = locator.resolve('events');

      const promise = new Promise((resolve, reject) => {
        events.on('error', reject);
        events.on('readyWatchers', watchers => {
          watchers.forEach(watcher => watcher.close());
          resolve();
        });
      });

      const watcher = locator.resolve('watcher');
      const loader = locator.resolve('collectionsLoader');

      await loader.load();
      await watcher.watchCollections();

      return promise;
    });

    it('should add new collection and load', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const anotherCollection = 'test/cases/collections/test1/test2';
      const fullPathNew = path.join(tmpPath, 'newCollection');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');
      let watchers;

      const onCollectionsLoaded = new Promise(resolve => events.on('allCollectionsLoaded', resolve));
      const onReadyWatchers = new Promise(resolve => {
        events.on('readyWatchers', w => {
          watchers = w;
          resolve();
        });
      });

      await copy(caseRoot, tmpPath);
      await loader.load();
      await watcher.watchCollections();
      await onReadyWatchers;

      const loaded = await onCollectionsLoaded;

      assert.equal(Object.keys(loaded).length, 1);

      const promise = new Promise((resolve, reject) => {
        events.on('collectionLoaded', collection => {
          if (collection.name !== 'cool') {
            return;
          }
          watchers.forEach(watcher => watcher.close());
          try {
            assert.equal(Object.keys(loader.getCollectionsByNames()).length, 2);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      await copy(anotherCollection, fullPathNew);
      await promise;
      await remove(tmpPath)

      // fs.removeSync(tmpPath); - need remove always temporary files
    });

    it('should reload collection on change in logic file', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'index.js');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');

      const onWatchReady = new Promise(resolve => events.on('readyWatchers', resolve));
      const changePromise = new Promise(resolve => watcher.on('change', resolve));

      await copy(caseRoot, tmpPath);
      await utils.wait(20);
      await loader.load();
      await watcher.watchCollections();
      const watchers = await onWatchReady;

      const promise = new Promise((resolve, reject) => {
        events.on('collectionLoaded', collection => {
          if (collection.name !== 'already') {
            return;
          }

          try {
            const instance = new collection.constructor();
            assert.equal(instance.foo(), 'foo');

            watchers.forEach(watcher => watcher.close());
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      let collectionJsonContent = fs.readFileSync(alreadyPath).toString();
      collectionJsonContent = collectionJsonContent.replace(/blablabla/, 'foo');

      await Promise.all([writeFile(alreadyPath, collectionJsonContent), promise, changePromise]);
    });

    it('should reload collection on change in collection.json', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');

      const onWatchReady = new Promise(resolve => events.on('readyWatchers', resolve));

      await copy(caseRoot, tmpPath);
      await utils.wait(30);
      await loader.load();
      await watcher.watchCollections();
      const watchers = await onWatchReady;

      const promise = new Promise((resolve, reject) => {
        events.on('collectionLoaded', collection => {
          if (collection.name !== 'already') {
            return;
          }

          try {
            watchers.forEach(watcher => watcher.close());
            assert.equal(collection.properties.additional, 'foo');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      let collectionJsonContent = fs.readFileSync(alreadyPath).toString();
      collectionJsonContent = collectionJsonContent.replace(/some2/, 'foo');

      await Promise.all([writeFile(alreadyPath, collectionJsonContent), promise]);
    });

    it('should remove collection on unlink collection.json', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');

      const onWatchReady = new Promise(resolve => events.on('readyWatchers', resolve));

      await copy(caseRoot, tmpPath);
      await utils.wait(30);
      await loader.load();
      await watcher.watchCollections();
      const watchers = await onWatchReady;

      const promise = new Promise((resolve, reject) => {
        watcher.on('unlink', collection => {
          if (collection.name !== 'already') {
            return;
          }

          try {
            watchers.forEach(watcher => watcher.close());
            assert.equal(Object.keys(loader._loadedCollections).length, 0);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      await Promise.all([remove(alreadyPath), promise]);
    });

    it('should skip collection on invalid change in collection.json', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'test-collection.json');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');

      const onWatchReady = new Promise(resolve => events.on('readyWatchers', resolve));
      const onError = new Promise(resolve => events.on('error', error => {
        assert.notEqual(String(error).indexOf('test-collection.json: Unexpected token \''), -1);
        resolve();
      }));

      await copy(caseRoot, tmpPath, 50);
      await loader.load();
      await watcher.watchCollections();

      const watchers = await onWatchReady;
      const onChange = new Promise(resolve => watchers[0].on('change', () => resolve()));
      const promise = onChange
        .then(() => onError)
        .then(() => assert.equal(Object.keys(loader._loadedCollections).length, 0))
        .then(() => watchers.forEach(watcher => watcher.close()));

      let collectionJsonContent = fs.readFileSync(alreadyPath).toString();
      collectionJsonContent = collectionJsonContent.replace(/"/, '\'');

      await Promise.all([writeFile(alreadyPath, collectionJsonContent), promise]);

    });

    it('should skip collection on invalid change in logic file', async () => {
      const caseRoot = 'test/cases/watch';
      const tmpPath = getTemporary(caseRoot);
      const alreadyPath = path.join(tmpPath, 'already', 'index.js');

      locator.registerInstance('config', {
        collectionsGlob: `${tmpPath}/**/test-collection.json`
      });

      const loader = locator.resolve('collectionsLoader');
      const watcher = locator.resolve('watcher');
      const events = locator.resolve('events');

      const onWatchReady = new Promise(resolve => events.on('readyWatchers', resolve));
      const onError = new Promise(resolve => events.on('error', error => {
        assert.notEqual(String(error).indexOf('SyntaxError'), -1);
        assert.equal(Object.keys(loader._loadedCollections).length, 0);
        resolve();
      }));

      await copy(caseRoot, tmpPath);
      await loader.load();
      await watcher.watchCollections();

      const watchers = await onWatchReady;
      const promise = onError.then(() => {
        watchers.forEach(watcher => watcher.close());
      });

      let collectionJsonContent = fs.readFileSync(alreadyPath).toString();
      collectionJsonContent = collectionJsonContent.replace(/{/, '\'');

      await Promise.all([writeFile(alreadyPath, collectionJsonContent), promise]);
    });
  });

  /**
   * Path temporary folder
   *
   * @param {String} root Base path
   * @returns {String} path of temporary folder
   */
  function getTemporary(root) {
    const rand = Math.floor(Math.random() * (100 - 1 + 1)) + 1;

    tmpFolder = path.normalize(path.join(root, `../__tmp__${Date.now()}__${rand}`));

    return tmpFolder;
  }
});

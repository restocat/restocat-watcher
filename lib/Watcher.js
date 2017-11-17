const {EventEmitter} = require('events');
const chokidar = require('chokidar');
const path = require('path');
const Promise = require('bluebird');

const CHOKIDAR_OPTIONS = {
  ignoreInitial: true,
  cwd: process.cwd(),
  ignorePermissionErrors: true
};

class Watcher extends EventEmitter {

  constructor(locator) {
    super();

    this._locator = locator;
    this._events = locator.resolve('events');
    this._collectionsFinder = locator.resolve('collectionsFinder');

    this._collectionJsonWatcher = null;
    this._collectionLogicWatcher = null;

    this._isCollectionsLoaded = new Promise(resolve => this._events.once('allCollectionsLoaded', () => resolve()));
  }

  /**
   * Watch changes in the collections (collection.json, logic file and etc.)
   *
   * @return {Promise} Promise resolve when collection.json and logic watchers ready
   */
  async watchCollections() {
    this._collectionsLoader = this._locator.resolve('collectionsLoader');

    await this._isCollectionsLoaded;

    const watchers = [
      await this.watchCollectionJsonFiles(),
      await this.watchLogicFiles()
    ];

    this._events.emit('readyWatchers', watchers);
    this._events.emit('info', 'Watchers ready');

    this
      .on('add', descriptor => {
        this._events.emit('info', `Collection "${descriptor.path}" has been added, initializing...`);
        this.requireClearCache(this._getLogicPath(descriptor));
        this._collectionsLoader.loadCollection(descriptor);
      })
      .on('change', args => {
        this._events.emit('info', `Scripts of the "${args.collection.name}" collection have been changed, reinitializing...`);

        const logicFile = this._getLogicPath(args.collection);
        const anotherFile = this._collectionsFinder.getFullPathForFile(args.filename);

        this.requireClearCache(anotherFile);
        this.requireClearCache(logicFile);

        this._collectionsLoader.loadCollection(args.collection);
      })
      .on('unlink', descriptor => {
        this._events.emit('info', `Collection "${descriptor.path}" has been unlinked, removing...`);
        this.requireClearCache(this._getLogicPath(descriptor));
        this._collectionsLoader.removeCollection(descriptor.name);
      });

    return watchers;
  }

  /**
   * Watch collection.json files
   *
   * @return {Promise} Promise resolved when watcher is ready
   */
  watchCollectionJsonFiles() {
    if (this._collectionJsonWatcher) {
      return this._collectionJsonWatcher;
    }

    this._collectionJsonWatcher = chokidar.watch(this._collectionsFinder.getCollectionsGlob(), CHOKIDAR_OPTIONS)
      .on('error', error => this._events.emit('error', error))

      // add new collection
      .on('add', filename => {
        const newCollection = this._collectionsFinder.newCollection(filename);

        if (!newCollection) {
          return;
        }

        this.emit('add', newCollection);
      })

      // change collection.json of the found collection
      .on('change', filename => {
        const collection = this._collectionsFinder.recognizesCollection(filename);

        if (!collection) {
          return;
        }

        // because collection name could be changed
        this._collectionsFinder.removeCollection(collection);
        this.emit('unlink', collection);

        const newCollection = this._collectionsFinder.reloadCollection(collection);

        if (!newCollection) {
          return;
        }

        this._locator.resolve('requestRouter').init();

        // re-initialization because endpoints param could be changed
        this.emit('add', newCollection);
      })

      // unlink found collection
      .on('unlink', filename => {
        const collection = this._collectionsFinder.recognizesCollection(filename);

        if (!collection) {
          return;
        }

        this._collectionsFinder.removeCollection(collection);
        this.emit('unlink', collection);
      });

    return new Promise((resolve, reject) => {
      this._collectionJsonWatcher
        .once('error', reject)
        .once('ready', () => resolve(this._collectionJsonWatcher));
    });
  }

  /**
   * Watch collection/logic.js files
   *
   * @return {Promise} Promise resolved when watcher is ready
   */
  async watchLogicFiles() {
    if (this._collectionLogicWatcher) {
      return this._collectionLogicWatcher;
    }

    const dirs = this._collectionsFinder.getDirsOfFoundCollections();

    this._collectionLogicWatcher = chokidar.watch(dirs, CHOKIDAR_OPTIONS)
      .on('error', error => this._events.emit('error', error))
      .on('change', filename => {
        const collection = this._collectionsFinder.recognizesCollection(filename);

        if (!collection) {
          return;
        }

        const collectionJson = collection.path;
        const logicFile = collection.logicFile;

        if (collectionJson === filename) {
          return;
        }

        const changeArgs = {
          filename,
          collection
        };

        this._locator.resolve('requestRouter').init();

        // logic file is changed
        if (filename === logicFile) {
          this.emit('changeLogic', collection);
          this.emit('change', changeArgs);
        } else {
          this.emit('change', changeArgs);
        }
      })
      .on('unlink', filename => {
        const collection = this._collectionsFinder.recognizesCollection(filename);

        if (!collection) {
          return;
        }

        const collectionJson = collection.path;
        const logicFile = collection.logicFile;

        // For collection.json is another watcher
        if (collectionJson === filename) {
          return;
        }

        this._locator.resolve('requestRouter').init();

        if (logicFile === filename) {
          this._collectionsFinder.removeCollection(collection);
          this.emit('unlink', {filename, collection});
        } else {
          this.emit('change', {filename, collection});
        }
      })
      .on('add', filename => {
        const collection = this._collectionsFinder.recognizesCollection(filename);

        // if collection is not exist of add collection.json file
        if (!collection || collection.path === filename) {
          return;
        }

        this._locator.resolve('requestRouter').init();

        this.emit('change', {filename, collection});
      });

    return new Promise((resolve, reject) => {
      this._collectionLogicWatcher
        .once('error', reject)
        .once('ready', () => resolve(this._collectionLogicWatcher));
    });
  }

  /**
   * Watch another files of project
   *
   * @return {Promise} Promise of closed watcher
   */
  watchAnotherFiles() {

  }

  /**
   * Gets an absolute path to the collection's logic file.
   *
   * @param {Object} collectionDetails The collection details object.
   * @returns {string} The absolute path to the logic file.
   * @private
   */
  _getLogicPath(collectionDetails) {
    return path.resolve(path.dirname(collectionDetails.path), collectionDetails.properties.logic);
  }

  /**
   * Clears the Node.js require cache for the specified key.
   *
   * @param {string} key The cache key.
   * @returns {void}
   */
  requireClearCache(key) {
    key = key || '';
    key = key.replace(/\\|\//g, path.sep);
    delete require.cache[key];
  }
}

module.exports = Watcher;

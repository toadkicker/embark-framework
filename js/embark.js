/*jshint esversion: 6 */
import * as Web3 from "web3";
import * as IpfsApi from "IpfsApi";
import * as HaadIpfsApi from 'HaadIpfsApi';

//var Ipfs = require('./ipfs.js');

//=========================================================
// Embark Smart Contracts
//=========================================================

//namespace
class EmbarkJS {
  constructor() {
    this.web3 = Web3;
  }
}

class Contract extends EmbarkJS {
  constructor(options) {
    super();
    this.abi = options.abi;
    this.address = options.address;
    this.code = `0x${options.code}`;
    this.eventList = [];

    if (Array.isArray(this.abi)) {
      for (let i = 0; i < this.abi.length; i++) {
        if (this.abi[i].type === 'event') {
          this.eventList.push(this.abi[i].name);
        }
      }
    }

    this._originalContractObject = this.ContractClass.at(this.address);
    this._methods = Object.getOwnPropertyNames(this._originalContractObject).filter(p => {
      // TODO: check for forbidden properties
      if (this.eventList.includes(p)) {

        this[p] = function () {
          const promise = this.messageEvents();
          const args = Array.prototype.slice.call(arguments);
          args.push((err, result) => {
            if (err) {
              promise.error(err);
            } else {
              promise.cb(result);
            }
          });

          this._originalContractObject[p].apply(this._originalContractObject[p], args);
          return promise;
        };
        return true;
      } else if (typeof this._originalContractObject[p] === 'function') {
        this[p] = function (_args) {
          const args = Array.prototype.slice.call(arguments);
          const fn = this._originalContractObject[p];
          const props = this.abi.find((x) => x.name === p);

          const promise = new Promise((resolve, reject) => {
            args.push((err, transaction) => {
              promise.tx = transaction;
              if (err) {
                return reject(err);
              }

              const getConfirmation = () => {
                this.web3.eth.getTransactionReceipt(transaction, (err, receipt) => {
                  if (err) {
                    return reject(err);
                  }

                  if (receipt !== null) {
                    return resolve(receipt);
                  }

                  setTimeout(getConfirmation, 1000);
                });
              };

              if (typeof(transaction) !== "string" || props.constant) {
                resolve(transaction);
              } else {
                getConfirmation();
              }
            });

            fn.apply(fn, args);
          });

          return promise;
        };
        return true;
      }
      return false;
    });
  }

  static ContractClass() {
    this.web3.eth.contract(this.abi);
  }

  messageEvents() {
    this.cb = () => {
    };

    let then = () => {
      this.cb();
    };

    let error = err => err;
  }

  deploy(args, _options) {
    let contractParams;
    const options = _options || {};

    contractParams = args || [];

    contractParams.push({
      from: this.web3.eth.accounts[0],
      data: this.code,
      gas: options.gas || 800000
    });

    const contractObject = this.web3.eth.contract(this.abi);

    return new Promise((resolve, reject) => {
      contractParams.push((err, transaction) => {
        if (err) {
          reject(err);
        } else if (transaction.address !== undefined) {
          resolve(new EmbarkJS.Contract({
            abi: this.abi,
            code: this.code,
            address: transaction.address
          }));
        }
      });

      // returns promise
      // deploys contract
      // wraps it around EmbarkJS.Contract
      contractObject["new"](...contractParams);
    });
  }

  at(address) {
    return new EmbarkJS.Contract({abi: this.abi, code: this.code, address});
  }

  send(value, unit, _options) {
    let options;
    let wei;
    if (typeof unit === 'object') {
      options = unit;
      wei = value;
    } else {
      options = _options || {};
      wei = this.web3.toWei(value, unit);
    }

    options.to = this.address;
    options.value = wei;
    console.log(options);

    this.web3.eth.sendTransaction(options);
  }

}

//=========================================================
// Embark Storage
//=========================================================

class Storage extends EmbarkJS {

  constructor(options) {
    super();
    this.protocol = options.protocol;
    this.server = options.server;
    this.port = options.port;
  }

  getUrl() {
    return `${this.protocol}${this.server}:${this.port}`;
  }
  saveText(text) {
    return this.currentStorage.saveText(text);
  }

  get(hash) {
    return this.currentStorage.get(hash);
  }

  uploadFile(inputSelector) {
    return this.currentStorage.uploadFile(inputSelector);
  }

  getUrl(hash) {
    return this.currentStorage.getUrl(hash);
  }

  setProvider(provider, options) {
    return new Promise((resolve, reject) => {
      if (provider.toLowerCase() === EmbarkJS.Storage.Providers.IPFS) {
        //I don't think currentStorage is used anywhere, this might not be needed
        //for now until additional storage providers are supported. But keeping it
        //anyways
        this.currentStorage = EmbarkJS.Storage.IPFS;

        try {
          if (options === undefined) {
            this.ipfsConnection = IpfsApi('localhost', '5001');
          } else {
            this.ipfsConnection = IpfsApi(this.server, this.port);
          }
          resolve(this);
        } catch (err) {
          this.ipfsConnection = null;
          reject(new Error('Failed to connect to IPFS'));
        }
      } else if (provider.toLowerCase() === EmbarkJS.Storage.SWARM) {
        reject('Swarm not implemented');
        // TODO Implement Swarm
        // this.currentStorage = EmbarkJS.Storage.SWARM;
        // if (options === undefined) {
        //     //Connect to default Swarm node
        // } else {
        //     //Connect using options
        // }
      } else {
        reject('Unknown storage provider');
      }
    });
  }


}

class Providers extends Storage {
  constructor() {
    super();
    return {
      IPFS: 'ipfs',
      SWARM: 'swarm'
    };
  }
}

class IPFS extends Storage {

  constructor() {
    super();
  }

  saveText(text) {
    return new Promise((resolve, reject) => {
      if (!EmbarkJS.Storage.ipfsConnection) {
        const connectionError = new Error('No IPFS connection. Please ensure to call Embark.Storage.setProvider()');
        reject(connectionError);
      }
      EmbarkJS.Storage.ipfsConnection.add((new EmbarkJS.Storage.ipfsConnection.Buffer(text)), (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result[0].path);
        }
      });
    });
  }

  get(hash) {
    // TODO: detect type, then convert if needed
    //var ipfsHash = web3.toAscii(hash);
    return new Promise((resolve, reject) => {
      if (!EmbarkJS.Storage.ipfsConnection) {
        const connectionError = new Error('No IPFS connection. Please ensure to call Embark.Storage.setProvider()');
        reject(connectionError);
      }
      EmbarkJS.Storage.ipfsConnection.object.get([hash]).then(node => {
        resolve(node.data);
      }).catch(err => {
        reject(err);
      });
    });
  }

  uploadFile(inputSelector) {
    const file = inputSelector[0].files[0];

    if (file === undefined) {
      throw new Error('no file found');
    }

    return new Promise((resolve, reject) => {
      if (!EmbarkJS.Storage.ipfsConnection) {
        const connectionError = new Error('No IPFS connection. Please ensure to call Embark.Storage.setProvider()');
        reject(connectionError);
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const fileContent = reader.result;
        const buffer = EmbarkJS.Storage.ipfsConnection.Buffer.from(fileContent);
        EmbarkJS.Storage.ipfsConnection.add(buffer, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result[0].path);
          }
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  getUrl(hash) {
    return `${this.protocol}${this.server}:${this.port}/ipfs/${hash}`;
  }
}

//=========================================================
// Embark Messaging
//=========================================================

class Messages extends EmbarkJS {
  setProvider(provider, options) {
    let ipfs;
    if (provider === 'whisper') {
      this.currentMessages = EmbarkJS.Messages.Whisper;
      if (typeof variable === 'undefined' && typeof(this.web3) === 'undefined') {
        if (options === undefined) {
          this.web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
        } else {
          this.web3 = new Web3(new Web3.providers.HttpProvider(`http://${options.server}:${options.port}`));
        }
      }
      this.web3.version.getWhisper((err, res) => {
        if (err) {
          console.log("whisper not available");
        } else if (web3.version.whisper >= 5) {
          console.log("this version of whisper is not supported yet; try a version of geth bellow 1.6.1");
        } else {
          this.currentMessages.identity = this.web3.shh.newIdentity();
        }
      });
    } else if (provider === 'orbit') {
      this.currentMessages = EmbarkJS.Messages.Orbit;
      if (options === undefined) {
        ipfs = HaadIpfsApi('localhost', '5001');
      } else {
        ipfs = HaadIpfsApi(options.host, options.port);
      }
      this.currentMessages.orbit = new Orbit(ipfs);
      if (typeof(this.web3) === "undefined") {
        this.currentMessages.orbit.connect(Math.random().toString(36).substring(2));
      } else {
        this.currentMessages.orbit.connect(this.web3.eth.accounts[0]);
      }
    } else {
      throw Error('Unknown message provider');
    }
  }

  sendMessage(options) {
    return this.currentMessages.sendMessage(options);
  }

  listenTo(options) {
    return this.currentMessages.listenTo(options);
  }

}

class Whisper extends Messages {
  sendMessage(options) {
    let topics = options.topic || options.topics;
    const data = options.data || options.payload;
    const identity = options.identity || this.identity || web3.shh.newIdentity();
    const ttl = options.ttl || 100;
    const priority = options.priority || 1000;
    let _topics;

    if (topics === undefined) {
      throw new Error("missing option: topic");
    }

    if (data === undefined) {
      throw new Error("missing option: data");
    }

    // do fromAscii to each topics unless it's already a string
    if (typeof topics === 'string') {
      _topics = [web3.fromAscii(topics)];
    } else {
      // TODO: replace with es6 + babel;
      for (let i = 0; i < topics.length; i++) {
        _topics.push(web3.fromAscii(topics[i]));
      }
    }
    topics = _topics;

    const payload = JSON.stringify(data);

    const message = {
      from: identity,
      topics,
      payload: web3.fromAscii(payload),
      ttl,
      priority
    };

    return web3.shh.post(message, () => {
    });
  }

  listenTo(options) {
    let topics = options.topic || options.topics;
    let _topics = [];

    if (typeof topics === 'string') {
      _topics = [topics];
    } else {
      for (let i = 0; i < topics.length; i++) {
        _topics.push(topics[i]);
      }
    }
    topics = _topics;

    const filterOptions = {
      topics
    };

    const messageEvents = function () {
      this.cb = () => {
      };
    };

    messageEvents.prototype.then = function (cb) {
      this.cb = cb;
    };

    messageEvents.prototype.error = err => err;

    messageEvents.prototype.stop = function () {
      this.filter.stopWatching();
    };

    const promise = new messageEvents();

    const filter = web3.shh.filter(filterOptions, (err, result) => {
      const payload = JSON.parse(web3.toAscii(result.payload));
      let data;
      if (err) {
        promise.error(err);
      } else {
        data = {
          topic: topics,
          data: payload,
          from: result.from,
          time: (new Date(result.sent * 1000))
        };
        promise.cb(payload, data, result);
      }
    });

    promise.filter = filter;

    return promise;
  }

}

class Orbit extends Messages {
  sendMessage(options) {
    let topics = options.topic || options.topics;
    const data = options.data || options.payload;

    if (topics === undefined) {
      throw new Error("missing option: topic");
    }

    if (data === undefined) {
      throw new Error("missing option: data");
    }

    if (Array.isArray(topics)) {
      // TODO: better to just send to different channels instead
      topics = topics.join(',');
    }

    this.orbit.join(topics);

    const payload = JSON.stringify(data);

    this.orbit.send(topics, data);
  }

  listenTo(options) {
    let topics = options.topic || options.topics;

    if (Array.isArray(topics)) {
      topics = topics.join(',');
    }

    this.orbit.join(topics);

    class messageEvents {
      constructor() {
        this.cb = () => {
        };
      }

      then(cb) {
        this.cb = cb;
      }

      static error(err) {
        return err;
      }
    }

    const promise = new messageEvents();

    this.orbit.events.on('message', (channel, message) => {
      // TODO: looks like sometimes it's receving messages from all topics
      if (topics !== channel) return;
      this.orbit.getPost(message.payload.value, true).then((post) => {
        const data = {
          topic: channel,
          data: post.content,
          from: post.meta.from.name,
          time: (new Date(post.meta.ts))
        };
        promise.cb(post.content, data, post);
      });
    });

    return promise;
  }
}

export default EmbarkJS;

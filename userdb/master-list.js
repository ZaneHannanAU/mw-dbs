const {EventEmitter} = require('events')
const cluster = require('cluster')
const readline = require('readline')
const fs = require('fs')
const util = require('util')
const path = require('path')
const os = require('os')
const {process_udb_message, default_find_key, max_times, n, delim, dKeys, keyMap, enumProps, csvjoin, hash} = require('./consts')

const [fsrename, fsclose, fsopen, appendFile] = [
  fs.rename,
  fs.close,
  fs.open,
  fs.appendFile
].map(util.promisify)

class UserList extends EventEmitter {
  /**
   * @constructor UserList
   * @extends eventemitter
   * @arg {object} v - base for everything else.
   // saving and file system
   * @arg {string|number} file to read/write from/to. Defaults to cwd/ulist.
   * @arg {string|number} filename - same as file.
   * @arg {string} tmp file to use when saving.
   * @arg {string} tmpfile to save to.
   // reading and storing
   * @arg {array<string|symbol>} keys for csv listing. Unused in object mode.
   * @arg {array<string>} enumProps - the properties to enumerate or keep ready.
   * @arg {array<string>} enumChangable - enumerable properties that may change.
   // options
   * @arg {boolean} isJSON - parse as json instead of CSV.
   * @arg {boolean} csvSimple - simple CSV; use strings for all functions.
   * @arg {string} delim to split strings by.
   // special
   * @arg {constructor} User class to run.
   * @arg {string} message_code to recieve requests
   */
  constructor({
    file = path.join(os.cwd(), 'ulist'), filename = file,
    tmp = filename + '~', tmpfile = tmp,
    keys = [...dKeys],
    enumProps = [...enumProps], enumChangable = [...enumChangable],
    isJSON = false, csvSimple = false, delim = delim,
    User = require('./master-user'),
    message_code = process_udb_message
  } = {}) {
    // emit warning, remove after made normal/sane
    process.emitWarning('master-worker-db-user is not intended for normal or production use; it is a base to modify for your own use.', {
      type: 'UnmodifiedWarning',
      code: 'MW_USER_DB_UNMODIFIED'
    })

    super()
    this.filename = filename
    this.tmpfile = tmpfile

    this.keys = keyMap(keys)
    this.enumProps = enumProps
    this.enumChangable = enumChangable
    this.User = User

    Object.defineProperties(this, {
      users: {
        enumerable: false,
        writable: false,
        value: []
      },
      enums: {
        enumerable: false,
        writable: false,
        value: {}
      },
      hrtimes: {
        enumerable: false,
        writable: false,
        value: []
      }
    })
    for (const prop of enumProps) this.enums[prop] = new Map
    setImmediate(this.init.bind(this))

    cluster.on('message', this.onMessage.bind(this, String(message_code)))
  }

  async init() {
    let {filename, keys, User} = this,
        enumreq = this.enumreq.bind(this),
        ln = 0

    let rl = readline.createInterface({
      input: fs.createReadStream(filename)
    }).on('line', async line => {
      if (line) new User(line, keys).on('ready', enumreq)
    })
  }
  enumreq(u) {
    this.users.push(u)
    for (const prop of this.enumProps) if (prop in u && u.hasOwnProperty(prop))
      if (!this.enums[prop].has(u[prop])) this.enums[prop].set(u[prop], u)
      else throw new Error('All enumerated properties must be unique.')
  }

  /**
   * @method push_hrtime
   * @arg {array<second as number, nanosecond as number>} time
   * @arg {string} method
   */
  push_hrtime([s, ns], method) {
    let l = this.hrtimes.push([s*n+ns, method])
    if (l > max_times) this.hrtimes.shift()
  }

  /**
   * @method getAvgTime
   * @arg {string} [type]
   * @returns {avgTime as number}
   */
  getAvgTime(T) {
    return this.times.reduce(time_reducer(T), 0) / this.times.length
  }

  /**
   * @method onMessage
   * @async
   * @private
   * @arg {string} message_code to retrieve.
   * @arg worker process that sent it
   * @arg message it contains
   * @prop {object} message.message_code to retrieve
   */
  async onMessage(message_code, worker, {[message_code]: msg}) {
    if (!msg) return;
    const hrtime = process.hrtime()
    const {
      method = 'get',
      ID,
      by = default_find_key,
      user,
      keys,
      args = []
      password, pw = password,
      check, ip
    } = msg
    const send = (json) => {
      const reply = Object.defineProperty(Object.create(null), message_code, {value: {}})
      const oc = reply[message_code]
      oc.ID = ID
      oc.method = method.toLowerCase()

      for (const key in json) if (json.hasOwnProperty(key)) oc[key] = json[key]

      worker.send(reply)

      this.push_hrtime(process.hrtime(hrtime), method)
    }

    const USER = this.enums[by].get(user)
    if (method.toLowerCase() !== 'add' && !USER)
      return send({user: null, keys: null, err: 'nouser'})
    else if (method.toLowerCase() === 'add' && USER)
      return send({err: 'userexists'})
    try {
      switch (method.toLowerCase()) {
        default: return send({user: null, err: 'method_unknown'})
        case undefined: return send({user: null, err: 'method_undefined'})
        case 'get': return send({user: USER.toJSON(keys, this)})

        case 'chk':
          return send({
            user: await USER.chk(pw) ? USER.toJSON(keys, this) : null
          })
        case 'chgpw':
          return send({
            user: (await USER.setPassword(pw, check, ip)).toJSON(keys)
          })

        case 'set':
          let set = []
          for (var key in keys) {
            if (keys.hasOwnProperty(key)) {
              USER[key] = keys[key]
              set.push(key)
            }
          }
          return send({user: USER.toJSON(keys, this), set})

        case 'cal':
          let value = await USER[msg.call](...args)
          if (value !== USER)
            return send({user: USER.toJSON(keys, this), value})
          else return send({user: USER.toJSON(keys, this)})
        case 'add':
          if (pw) let npw = await hash(pw)
          return new this.User({[by]: user, password: npw || null}, this.keys)
            .on('ready', this.enumreq.bind(this))
      }
    } catch (e) {
      return send({user: null, err: String(e)})
    }
  }

  /**
   * @method save
   * @arg {array<string|symbol>} keys
   * @arg {boolean} json - save as json
   * @arg {boolean} sync - save syncronously
   */
  save(keys = this.keys, json, sync) {
    if (typeof keys === 'boolean') {
      let k = json
      json = keys
      keys = k || this.keys
    }
    return (json || this.saveAsJSON || this.JSONdefault)
      ? this.saveJSON(keys, sync)
      : this.saveCSV(keys, sync)
  }

  /**
   * @method saveCSV
   * @arg {undefined|array<string|symbol>} keys
   * @arg {boolean} sync
   */
  saveCSV(keys = this.keys, sync) {
    if (!sync) {
      return new Promise(async (res, rej) => {
        try {
          await fsrename(this.filename, this.tmpfile)
          let fd = await fsopen(this.filename, 'ax')
          for (let i = 0; i < this.users.length; i++)
            await appendFile(fd, this.users[i].toCSV(keys, csvjoin), 'utf8')
          return res(await fsclose(fd))
        } catch (e) {
          return rej(e)
        }
      })
    } else {
      try {
        fs.renameSync(this.filename, this.tmpfile)
        let fd = fs.openSync(this.filename, 'ax')
        for (let i = 0; i < this.users.length; i++)
          fs.appendFileSync(fd, this.users[i].toCSV(keys, csvjoin), 'utf8')
        ;;
        return fs.closeSync(fd)
      } catch (e) {
        console.error(e);
        throw e
      }
    }
  }

  saveJSON(keys = this.keys, sync) {
    if (!sync) {
      return new Promise(async (res, rej) => {
        try {
          await fsrename(this.filename, this.tmpfile)
          let fd = await fsopen(this.filename, 'ax')
          for (let i = 0; i < this.users.length; i++)
            await appendFile(fd, JSON.stringify(
              keys ? this.users[i].toJSON(keys) : this.users[i]
            ), 'utf8')
          return res(await fsclose(fd))
        } catch (e) {
          return rej(e)
        }
      })
    } else {
      try {
        fs.renameSync(this.filename, this.tmpfile)
        let fd = fs.openSync(this.filename, 'ax')
        for (let i = 0; i < this.users.length; i++)
          fs.appendFileSync(fd, this.users[i].toCSV(keys, csvjoin), 'utf8')
        ;;
        return fs.closeSync(fd)
      } catch (e) {
        console.error(e);
        throw e
      }
    }
  }
}
module.exports = exports = UserList
exports.User = require('./master-user')

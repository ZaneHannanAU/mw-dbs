const cluster = require('cluster');
const os = require('os');
const delim = ';'
const shared = module.exports = Object.create(null);

shared.process_udb_message = 'mwdb_user_message_request' // default key to use for messages.
shared.default_find_key = 'uname' // default key to find by
shared.max_times = 1e3 // max stored times
shared.arrd = 99 // default max array length
shared.n = 1e9 // nanoseconds in a second.
shared.salt_rounds = 11 // salt rounds defaults

let lim_arr = (arr = [], ml) => Object.defineProperties(Array.from(arr), {
  max_length: {
    set(v) {
      if (v < 1 || v > Math.pow(2, 32)-1) throw new RangeError('limited arrays cannot have length less than 0 or greater than 2^32')

      return Object.defineProperty(this, Symbol.for('max_length'), {
        value: v
      })
    },
    get() {return this[Symbol.for('max_length')] || ml || shared.arrd}
  },
  _push: {
    value(data) {
      while (this.length > this.max_length) this.shift()
      return this.push(data)
    }
  },
  _unshift: {
    value(data) {
      while (this.length > this.max_length) this.pop()
      return this.unshift(data)
    }
  },
  _clean: {
    value(f = true, lr = 1) {
      if (f) this.filter(v => v) // remove holes
      if (lr < 0)
        while (this.length > this.max_length) this.pop()
      else if (lr > 0)
        while (this.length > this.max_length) this.shift()
      else this.length = this.max_length
    }
  },
  _clear: {
    enumerable: false,
    writable: false,
    configurable: false,
    value() {return this.length = 0}
  }
})
shared.lim_arr = lim_arr

/**
 * @func date
 * @arg {number|date as string} v value to parse
 * @returns {date as number}
 */
let date = v => typeof v !== 'string' ? new Date() : new Date(v)
shared.date = date
// dated user creation

/**
 * @func uuid
 * @public
 * @returns {string(86)}
 */
if (cluster.isWorker) {
  shared.uuid = function uuid (v, self) {
    if (v) return v

    throw new Error('uuid cannot be falsy')
  }
} else if (cluster.isMaster) {
  const crypto = require('crypto');
  shared.uuid = function uuid (v, self) {
    if (v) return v

    let data = [
      self.uname,
      self.password,
      self.email,
      self.phone,
      self.date.toGMTString()
    ].join(';')
    let pool = crypto.createHash('whirlpool')
    pool.write(data)
    // let md5 = crypto.createHash('md5')
    // md5.write(data)
    return pool.digest('base64').slice(0,-2)
      .replace(/\+|\//g, m=>m==='+'?'-':'_') // URL safe 86 length string
  }
}
// unique user id.
// initally created from username, known password, email address, phone, signup date/time
let data = (v = {access: {fail: 0, last: []}, pwchg: []}) => {
  v.access.last = lim_arr(v.access.last)
  v.pwchg = lim_arr(v.pwchg)

  return v
}
shared.data = data

shared.dKeys = ['uname', 'password', 'email', 'phone', shared.date, shared.uuid, shared.data]
shared.keySet = (self, [key, fn], value) => {
  switch (typeof fn) {
    case 'undefined':
      if (key === undefined) return undefined
      else return self[key] = value
    case 'function':
      if (key && key !== 'anonymous')
        return self[key] = fn(value)
      else throw new Error('unnamed/anonymous function cannot be used as key')
  }
}
shared.keyMap = (keys = [...shared.dKeys]) => typeof keys !== 'string'
  ? keys.map(k => typeof k === 'string' ? [k] : [k[0] || k.name, k[1] || k])
  : Array.from(keys.split(shared.delim), v=>[String(v)])

shared.enumProps = ['uname', 'uuid', 'email', 'phone']
shared.enumChangable = ['email', 'phone']

shared.csvjoin = os.EOL
shared.jsonjoin = '\n'

/**
 * @func time_reducer
 * @arg {number} t - total
 * @arg {array<ns as number, method as string>} c
 */
const time_reducer = T => (t, [ns, m]) => !T || T === m ? t + ns : t
shared.time_reducer = time_reducer

/**
 * @generator
 * @func split
 * @arg {string} str to split into json
 * @arg {string} DELIM to split with
 * @yields {*}
 */
shared.split = function* split(str, DELIM = delim) {
  let inString = false, escNext = false, depth = 0, chars = [],
  y = (n = -1) => (n < 0 ? chars.length > 1 : chars.length > 0)
    ? JSON.parse((n ? chars.slice(0,n) : chars).join(''))
    : undefined

  for (const char of str) {
    // console.log({char, chars, inString, escNext, depth})
    chars.push(char)
    if (escNext) {
      escNext = false
      continue
    }
    switch (char) {
      case '\\': escNext = true; break;
      case '"': inString = !inString; break;
      case '[': if (!inString) depth++; break;
      case '{': if (!inString) depth++; break;
      case ']': if (!inString) depth--; break;
      case '}': if (!inString) depth--; break;
      case DELIM:
        if (!inString && depth === 0) {
          yield y()
          chars.length = 0
        }
        break;
    }
  }
  yield y(chars[chars.length-1] === DELIM ? -1 : 0)
}

shared.delim = delim

if (cluster.isMaster) {
  const master_only = shared
  const tn = ()=>null
  try {
    master_only.bcrypt = require('bcrypt')
  } catch (e) {
    try {
      master_only.bcrypt = require('bcryptwasm')
    } catch (e) {
      master_only.bcrypt = require('bcryptjs')
    }
  }
  let {salt_rounds: r = 11} = master_only
  /**
   * @func hash
   * @private
   * @async
   * @arg {string} pw to hash
   * @arg {number|buffer} salt
   * @callback cb taking (err, pwd) or undefined
   * @callback pcb taking (progress)
   * @returns {promise<hash as string>}
   * @throws {promise<error>}
   */
  master_only.hash = (pw, salt = r, cb, pcb = tn) => new Promise((res, rej) => {
    pcb(0.0)
    master_only.bcrypt.hash(pw, salt, (err, pwd) => {
      if (cb) cb(err, pwd)

      if (err) rej(err)
      else res(pwd)

      return pcb(1.0)
    }, pcb)
  })

  /**
   * @func compare
   * @private
   * @async
   * @arg {string} pw to compare
   * @arg {number|buffer} hash to compare pw to
   * @callback cb taking (err, pwd) or undefined
   * @callback pcb taking (progress)
   * @returns {promise<boolean>}
   * @throws {promise<error>}
   */
  master_only.compare = (pw, hash, cb, pcb = tn) => new Promise((res, rej) => {
    pcb(0.0)
    master_only.bcrypt.compare(pw, hash, (err, same) => {
      if (cb) cb(err, same)

      if (err) rej(err)
      else res(same)

      return pcb(1.0)
    }, pcb)
  })
}

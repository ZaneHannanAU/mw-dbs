const {process_udb_message, default_find_key, n, time_reducer, delim, dKeys, keyMap, enumProps, csvjoin} = require('./consts')

class UserList {
  constructor({
    keys = [...dKeys],
    enumProps = [...enumProps],
    User = require('./worker-user'),
    Cache = require('./worker-cache'),
    message_code = process_udb_message
  } = {}) {
    this.keys = keyMap(keys))

    this.enumProps = enumProps
    this.User = User
    this.Cache= Cache

    Object.defineProperties(this, {
      hrtimes: {
        enumerable: false,
        writable: false,
        value: []
      },
      requests: {
        enumerable: false,
        writable: false,
        value: []
      }
    })

    this.message_code = message_code

    process.on('message', this.onMessage.bind(this, String(message_code)))
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
   * @arg {string} message_code to index into the message
   * @arg message it contains
   * @prop {object} message.message_code to retrieve
   */
  async onMessage(message_code, {[message_code]: msg} = {}) {
    if (!msg) return;

    return this.requests[msg.ID](msg)
  }
  /**
   * @method request
   * @async
   * @arg {string} method to fetch, or similar handler
   * @arg {object} props
   * @prop {string} by
   * @prop {string} user
   * @prop {string} password optional, useful
   * @prop {string} pw optional, defaults to password
   * @prop {array<string>} keys to use
   * @prop {array<*>} args to execute with. Not asked.
   * @returns {promise<object[method, by, user, ...]>}
   */
  request(method, {by, user, password, pw = password, keys, args}) {
    const hrtime = process.hrtime()
    return new Promise((res, rej) => {
      const message = msg => {
        res(msg)

        this.push_hrtime(process.hrtime(hrtime), msg.method)
        return delete this.requests[msg.ID]
      }
      message.method = method.toLowerCase()
      message.by = by

      process.send({
        [this.message_code]: {
          method: message.method,
          by, user, pw, keys, args,
          ID: this.requests.push(msg)-1
        }
      })
    });
  }

  /**
   * @method createCache
   * @arg {constructor} Cache constructor, should be a class.
   * @returns {cache as object}
   */
  createCache(Cache = this.Cache) {
    return new Cache(this)
  }

  /**
   * @method createMiddlewareCache
   * @arg {constructor} Cache constructor, should be a class.
   * @returns {middleware as function}
   */
  createMiddlewareCache(Cache = this.Cache) {
    let self = this
    return async (req, res, next) => {
      if (typeof res.locals !== 'object') res.locals = {};
      res.locals.udbCache = new Cache(self)
      return typeof next === 'function' ? next() : null
    }
  }
}

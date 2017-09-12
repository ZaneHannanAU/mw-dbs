const {EventEmitter} = require('events'), // user
      [PASSWORD] = ['password'].map(Symbol.for),
      {dKeys, keyMap, keySet, delim, split, csvjoin, compare, hash, salt_rounds} = require('./consts')


class User extends EventEmitter {
  /**
   * @constructor user
   * @extends eventemitter
   * @arg {string|array<string>|object} ud - user data in string/dsv, array or object format.
   * @arg {array<string|symbol>} keys for user data, only used in string/dsv or array.
   */
  constructor(ud, keys = dKeys) {
    let i = 0
    keys = keyMap(keys)

    super()


    if (typeof ud === 'string' && keys.length > 0)
      for (const data of split(ud)) keySet(this, keys[i++], data)

    else if (Array.isArray(ud) && keys.length > 0)
      for (const data of ud) keySet(this, keys[i++], data)


    else for (const [key, fn] of keys) // easier
    // else for (const prop in ud)
      if (ud.hasOwnProperty(prop))
        keySet(this, [key, fn], ud[key])
    ;;

    // setup done
    setImmediate(this.emit.bind(this), 'ready', this)
  }
  toJSON(keys, parent) {
    let json = Object.create(null)
    if (keys) {
      keys = keyMap(keys)

      if (Array.isArray(keys)) {
        for (const key of keys)
          if (key in this && typeof this[key] !== 'function')
            json[key] = this[key]

      } else {
        for (const key in keys)
          if (keys.hasOwnProperty(key) && key in this && typeof this[key] !== 'function')
            json[key] = this[key]
      }
      ;;

      return json
    } else {
      json.password = this.password
      for (var prop in this) if (this.hasOwnProperty(prop))
        json[prop] = this[prop]
      return json
    }
  }

  toCSV(keys = dKeys, end, str = []) {
    keys = keyMap(keys)

    for (const key of keys)
      if (key in this && typeof this[key] !== 'function')
        str.push(JSON.stringify(this[key]))
      else str.push('')

    return end ? str.join(delim) + end : str.join(delim)
  }

  /**
   * @prop password
   * @access protected
   */
  get password() {return this[PASSWORD]}
  set password(pw) {
    if (pw && String(pw) === pw) {
      if (pw.length && pw.length >= 59 && pw.length <= 60) {
        // Symbol prop. Also inenumerable.
        Object.defineProperty(this, PASSWORD, {
          enumerable: false,
          writable: true,
          value: String(pw)
        });
        return this[PASSWORD];
      } else throw new RangeError('(hash) pw length must be 59 or 60')
    } else throw new TypeError('(hash) pw does not exist or is not a string')
  }

  /**
   * @method setPassword
   * @async
   * @emits {number} pw_progress
   * @emits {number} chk_progress
   // props
   * @arg {string} pw to hash.
   * @arg {string} check the password against current or new.
   * @arg {number|string|buffer} salt or rounds to use.
   * @arg {string} ip of the change requester.
   // promises given
   * @returns {promise<self>}
   * @throws {promise<string>}
   */
  async setPassword(pw, check, ip, salt = this.salt_rounds || salt_rounds) {
    if (!(check && check !== pw)) throw 'same'

    this.emit('pw_progress', 0.0)
    let date = new Date,
        attempt = this.chk(check),
        npw = hash(pw, salt, null, this.emit.bind(this, 'pw_progress'))

    if (await attempt) {
      this.data.pwchg._unshift({date, ip, ok: true, prev: this.password})
      this.password = await npw
      return this
    } else {
      this.data.pwchg._unshift({date, ip, ok: false})
      throw 'check_attempt_diff'
    }
  }

  async resetPassword(pw, ip, salt = this.salt_rounds || salt_rounds) {
    this.password = await hash(pw, salt, 0, this.emit.bind(this, pw_progress))
    return this
  }

  /**
   * @method chk
   * @async
   * @arg {string} pw
   * @emits {number} chk_progress
   */
  chk(pw) {
    const progress = this.emit.bind(this, 'chk_progress')
    return compare(pw, this.password, null, progress)
  }
}

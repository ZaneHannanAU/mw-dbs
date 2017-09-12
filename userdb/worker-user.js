const {keySet, keyMap} = require('./consts');

class User {
  constructor(ud, keys = keyMap(), req) {
    this.request = req
    this.keys = keys
    for (const key of keys) {
      keySet(this, key, ud[key[0]])
    }
  }
  set password(pw){return null}
  get password(){throw 'worker_user_no_pw'}
  async setPassword(pw, salt, check, {ip}) {
    let u = await this.request('chgpw', {pw, salt, check, ip})
    for (const key of this.keys) {
      keySet(this, key, u[key[0]])
    }
    return this
  }
}

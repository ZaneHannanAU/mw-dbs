const request = Symbol.for('request')
class Cache {
  constructor(self) {
    this[request] = self.request.bind(self)
    Object.defineProperties(this, {
      User: {value: self.User},
      keys: {value: self.keys},
      props: {
        enumerable: false,
        value: self.enumProps.reduce((o, prop) => Object.defineProperty(o, prop, {enumerable: true, writable: false, value: new Map}), {})
      }
    })
  }

  async requestUser(method, data) {
    if (this.props.hasOwnProperty(data.by || default_find_key)) {
      const user = this.props[data.by || default_find_key].get(data.user)
      if (user) return user
    }
    const msg = await this[request](method, data)
    if (msg.user) {
      const user = new this.User(msg.user, this.keys, this[request])
      for (const prop in this.props) {
        if (
          this.props.hasOwnProperty(prop)
          && user.hasOwnProperty(prop)
        ) {
          this.props[prop].set(user[prop], user)
        }
      }
      return user
    } else if (msg.err) {
      throw msg.err
    }
    return null
  }
}
module.exports = Cache;

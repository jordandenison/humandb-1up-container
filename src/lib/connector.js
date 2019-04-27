const superagent = require('superagent')
const feathers = require('@feathersjs/feathers')
const auth = require('@feathersjs/authentication-client')
const rest = require('@feathersjs/rest-client')
const logger = require('winston')

const url = process.env.AUTH_API_URL || 'http://hdb-dash-auth:3001/auth'

const app = feathers()

const restClient = rest(url)

app
  .configure(restClient.superagent(superagent))
  .configure(auth({ path: '/authentication' }))

const delay = async time => new Promise(resolve => setTimeout(resolve, time))

let accessToken
const authenticate = async (email, password) => {
  try {
    const res = await app.authenticate({ strategy: 'local', email, password })
    logger.info('Successfully authenticated against auth API')

    accessToken = res.accessToken
  } catch (e) {
    logger.error(`Error authenticating against auth API: ${e.message}`)

    await delay(5000)

    return authenticate(email, password)
  }
}

const init = async (email, password) => {
  if (!accessToken) {
    await authenticate(email, password)
  }

  return app
}

const getAccessToken = () => {
  if (!accessToken) { throw new Error('No access token found. Init must be executed first.') }

  return accessToken
}

module.exports = {
  init,
  app,
  getAccessToken
}

const superagent = require('superagent')
const { map } = require('bluebird')
const { init: authInit } = require('humandb-auth-api-connector')

const { delay } = require('lib/util')

const url = process.env.ONE_UP_API_URL || 'https://api.1up.health'
const clientId = process.env.ONE_UP_CLIENT_ID
const clientSecret = process.env.ONE_UP_CLIENT_SECRET
const accessTokenLifespan = process.env.ACCESS_TOKEN_LIFESPAN || 7000000

let currentAccessToken

const getAuthCode = async userId => {
  const newUserResult = await superagent.post(`${url}/user-management/v1/user`).send({ client_id: clientId, client_secret: clientSecret, app_user_id: userId })

  if (newUserResult.body.success) {
    return newUserResult.body.code
  }

  const existingUserResult = await superagent.post(`${url}/user-management/v1/user/auth-code`).send({ client_id: clientId, client_secret: clientSecret, app_user_id: userId })

  return existingUserResult.body.code
}

const getTokensWithCode = async code => {
  const result = await superagent.post(`${url}/fhir/oauth2/token`).send({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code })

  currentAccessToken = result.body.access_token

  return { accessToken: result.body.access_token, refreshToken: result.body.refresh_token }
}

const getTokensWithRefreshToken = async refreshToken => {
  const result = await superagent.post(`${url}/fhir/oauth2/token`).send({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken })

  currentAccessToken = result.body.access_token

  return { accessToken: result.body.access_token, refreshToken: result.body.refresh_token }
}

const storeUserTokens = (app, accessToken, refreshToken) =>
  app.service('user').patch(null, { oneUpAccessToken: accessToken, oneUpRefreshToken: refreshToken, oneUpClientId: clientId }, { query: { role: 'owner' } })

const watchRefreshTokens = async (app, originalRefreshToken) => {
  await delay(accessTokenLifespan)

  let newRefreshToken

  try {
    const { accessToken, refreshToken } = await getTokensWithRefreshToken(originalRefreshToken)
    newRefreshToken = refreshToken
    await storeUserTokens(app, accessToken, refreshToken)
  } catch (e) {
    console.log(`Error refreshing 1up tokens ${e.message}`)
  }

  return watchRefreshTokens(app, newRefreshToken || originalRefreshToken)
}

const getCredentials = async () => {
  if (!currentAccessToken) {
    await delay(2000)
    return getCredentials()
  }

  return { url, accessToken: currentAccessToken }
}

const syncData = async () => {
  const { accessToken } = await getCredentials()

  const result = await superagent.get(`${url}/fhir/dstu2/Patient`).set({ Authorization: `Bearer ${accessToken}` })
  await map(result.body.entry, async entry => {
    const entryResult = await superagent.get(entry.fullUrl).set({ Authorization: `Bearer ${accessToken}` })

    return superagent.put(`${process.env.FHIR_SERVER_BASE_URL}/Patient/${entryResult.body.id}`).send(entryResult.body)
  })
}

const init = async () => {
  const authApiUsername = process.env.AUTH_API_USERNAME || 'test'
  const authApiPassword = process.env.AUTH_API_PASSWORD || 'test'

  const app = await authInit(authApiUsername, authApiPassword)

  const ownerResults = await app.service('user').find({ query: { role: 'owner' } })
  const [owner] = ownerResults.data

  const code = await getAuthCode(owner.id)
  const { accessToken, refreshToken } = await getTokensWithCode(code)
  await storeUserTokens(app, accessToken, refreshToken)

  watchRefreshTokens(app, refreshToken)

  if (process.env.ONE_UP_SYNC_ON_STARTUP) {
    syncData()
  }
}

module.exports = {
  init,
  syncData,
  getCredentials
}

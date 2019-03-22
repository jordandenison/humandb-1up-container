const superagent = require('superagent')
const { map } = require('bluebird')
const { init: authInit } = require('humandb-auth-api-connector')

const { delay } = require('lib/util')
const fhriResourcesStu2 = require('data/fhir-resources-stu2')

const url = process.env.ONE_UP_API_URL || 'https://api.1up.health'
const clientId = process.env.ONE_UP_CLIENT_ID
const clientSecret = process.env.ONE_UP_CLIENT_SECRET
const accessTokenLifespan = process.env.ACCESS_TOKEN_LIFESPAN || 7000000

let app
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

const notify = async ({ status, description, dependency = 'FHIR Data Retrieval', error = '', service = '1up' }) => {
  const query = { service, dependency }
  const { total } = await app.service('status').find({ query })

  if (total) {
    return app.service('status').patch(null, { status, error, description }, { query })
  }

  return app.service('status').create({ service, status, dependency, description, error })
}

const syncData = async () => {
  try {
    await notify({ description: 'Data sync started.', status: 'In Progress' })

    const { accessToken } = await getCredentials()

    const resourceCount = {}

    await map(fhriResourcesStu2, async resource => {
      await notify({ description: `Syncing "${resource}" resource.`, status: 'In Progress' })

      const fetch = async (nextUrl) => {
        const result = await superagent.get(nextUrl).set({ Authorization: `Bearer ${accessToken}` })

        if (resourceCount[resource]) {
          resourceCount[resource] += result.body.entry.length
        } else {
          resourceCount[resource] = result.body.entry.length
        }

        await map(result.body.entry, async entry => {
          const entryResult = await superagent.get(entry.fullUrl).set({ Authorization: `Bearer ${accessToken}` })

          try {
            await superagent.put(`${process.env.FHIR_SERVER_BASE_URL_STU2}/${resource}/${entryResult.body.id}`).send(entryResult.body)
          } catch (e) {
            console.log(`Error inserting ${resource} ${entryResult.body.id}, error: ${e.message}`)
          }
        })

        const next = result.body && Array.isArray(result.body.link) && result.body.link.reduce((result, link) => {
          if (result) { return result }

          if (link.relation === 'next') {
            return link.url
          }
        }, '')

        if (next) {
          return fetch(next)
        }
      }

      return fetch(`${url}/fhir/dstu2/${resource}`)
    }, { concurrency: 1 })

    // await map(fhriResourcesStu3, async resource => {
    //   const result = await superagent.get(`${url}/fhir/dstu3/${resource}`).set({ Authorization: `Bearer ${accessToken}` })
    //   console.log('res body stu3 ', result.body.entry) // undefined
    //   await map(result.body.entry, async entry => {
    //     const entryResult = await superagent.get(entry.fullUrl).set({ Authorization: `Bearer ${accessToken}` })

    //     return superagent.put(`${process.env.FHIR_SERVER_BASE_URL_STU3}/${resource}/${entryResult.body.id}`).send(entryResult.body)
    //   })
    // }, { concurrency: 1 })

    // const description = `Data sync finished. Total records synced: ${JSON.stringify(resourceCount, null, 2)}`
    const description = `Data sync finished. Total records synced: ${Object.keys(resourceCount).reduce((result, key) => {
      result = result + resourceCount[key]
      return result
    }, 0)}.`
    await notify({ description, status: 'Complete' })

    console.log('Syncing Data Finished')
  } catch (e) {
    await notify({ description: 'Data sync error', status: 'Incomplete', error: e.message })
    console.log(`Syncing Data Error ${e.stack}`)
  }
}

const init = async () => {
  const authApiUsername = process.env.AUTH_API_USERNAME || 'test'
  const authApiPassword = process.env.AUTH_API_PASSWORD || 'test'

  app = await authInit(authApiUsername, authApiPassword)

  const ownerResults = await app.service('user').find({ query: { role: 'owner' } })
  const [owner] = ownerResults.data

  const code = await getAuthCode(owner.id)
  const { accessToken, refreshToken } = await getTokensWithCode(code)
  await storeUserTokens(app, accessToken, refreshToken)

  watchRefreshTokens(app, refreshToken)

  if (process.env.ONE_UP_SYNC_ON_STARTUP) {
    syncData()
  } else {
    await notify({ description: 'Data sync ready.', status: 'Available' })
  }
}

module.exports = {
  init,
  syncData,
  getCredentials
}

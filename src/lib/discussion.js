const superagent = require('superagent')

const { getAccessToken } = require('humandb-auth-api-connector-rest')

const postMessage = async (title, raw) => {
  const chatBody = { title, raw }

  try {
    // POST against the Discourse API to post the message
    const { body: json } = await superagent
      .post(`http://hdb-dash-auth:3001/auth/discussion/post/event`)
      .set({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Bearer ${getAccessToken()}`
      })
      .send(chatBody)

    console.log(chatBody, json)

    return { chatBody, json }
  } catch (e) {
    console.log(`Error posting messaging ${e.message}`)
    throw e
  }
}

module.exports = {
  postMessage
}

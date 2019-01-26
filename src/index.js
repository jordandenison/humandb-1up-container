require('app-module-path').addPath(__dirname)

const express = require('express')
const app = express()
const port = process.env.PORT || 80

const oneUp = require('lib/1up')

app.get('/sync-data', async (req, res, next) => {
  try {
    await oneUp.syncData()
  } catch (e) {
    next(e)
  }

  res.json({ status: 'success' })
})

app.listen(port, () => {
  oneUp.init()

  console.log(`1up health container listening on port ${port}!`)
})
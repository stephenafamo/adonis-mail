'use strict'

/**
 * adonis-framework
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

/* global it, describe, context, after */
const Mail = require('../../src/Mail')
const chai = require('chai')
const Ioc = require('adonis-fold').Ioc
const fs = require('fs')
const path = require('path')
const got = require('got')
require('dotenv').config({path: path.join(__dirname, '../../.env')})
const expect = chai.expect
require('co-mocha')

const Config = {
  get: function (key) {
    switch (key) {
      case 'mail.driver':
        return 'smtp'
      case 'mail.smtp':
        return {
          host: 'mailtrap.io',
          pool: true,
          port: 2525,
          auth: {
            user: process.env.MAILTRAP_USERNAME,
            pass: process.env.MAILTRAP_PASSWORD
          }
        }
    }
  }
}

const mailtrapUri = 'https://mailtrap.io/api/v1/inboxes/28268'
const mailTrapHeaders = {'Api-Token': process.env.MAILTRAP_APIKEY}

Ioc.bind('Config', function () {
  return Config
})

const View = {
  render: function * (name) {
    return new Promise(function (resolve, reject) {
      fs.readFile(`${path.join(__dirname, './views/' + name + '.html')}`, function (error, contents) {
        if (error) reject(error)
        else resolve(contents.toString('utf8'))
      })
    })
  }
}
const mail = new Mail(View, Config)

describe('Smtp driver', function () {
  context('Mail', function () {
    it('should not create the driver instance, until one of the mailing methods have been called', function () {
      const mail = new Mail()
      expect(mail instanceof Mail).to.equal(true)
    })

    it('should be able to extend mail provider', function * () {
      class Dummy {
        * send () {
          return 'send called'
        }
      }
      Mail.extend('dummy', new Dummy())
      const Config = {
        get: function () {
          return 'dummy'
        }
      }
      const mail = new Mail(View, Config)
      const i = yield mail.send('welcome', {}, function () {})
      expect(i).to.equal('send called')
    })

    it('should not create the driver instance if already exists', function * () {
      class Dummy {
        * send () {
          return 'send called'
        }
      }
      Mail.extend('dummy', new Dummy())
      const Config = {
        get: function () {
          return 'dummy'
        }
      }
      const mail = new Mail(View, Config)
      yield mail.send('welcome', {}, function () {})
      yield mail.raw('welcome', function () {})
      expect(Object.keys(mail.connectionPools).length).to.equal(1)
      expect(Object.keys(mail.connectionPools)).deep.equal(['default'])
    })

    it('should create the driver instance if does not exists', function * () {
      class Dummy {
        * send () {
        }
      }

      class Custom {
        * send () {
        }
      }
      Mail.extend('dummy', new Dummy())
      Mail.extend('custom', new Custom())

      const Config = {
        get: function () {
          return 'dummy'
        }
      }

      const mail = new Mail(View, Config)
      yield mail.send('welcome', {}, function () {})
      yield mail.new('custom').raw('welcome', function () {})
      expect(Object.keys(mail.connectionPools).length).to.equal(2)
      expect(Object.keys(mail.connectionPools)).deep.equal(['default', 'custom'])
    })
  })

  context('Sending Mail', function () {
    this.timeout(10000)

    after(function * () {
      yield got.patch(`${mailtrapUri}/clean`, {headers: mailTrapHeaders})
    })

    it('should be able to send raw email', function * () {
      yield mail.raw('Hello world', function (message) {
        message.to('virk@inbox.mailtrap.io')
        message.from('random@bar.com')
        message.subject('This is a raw email')
      })
      const mailTrapResponse = yield got(`${mailtrapUri}/messages`, {headers: mailTrapHeaders})
      const emailBody = JSON.parse(mailTrapResponse.body)[0]
      expect(emailBody.subject).to.equal('This is a raw email')
      expect(emailBody.text_body.trim()).to.equal('Hello world')
      expect(emailBody.from_email).to.equal('random@bar.com')
      expect(emailBody.to_email).to.equal('virk@inbox.mailtrap.io')
    })

    it('should be able to send attachments with email', function * () {
      yield mail.raw('Email with attachment', function (message) {
        message.to('virk@inbox.mailtrap.io')
        message.from('random@bar.com')
        message.subject('Email with attachment')
        message.attach(path.join(__dirname, './assets/logo_white.svg'))
      })
      const mailTrapResponse = yield got(`${mailtrapUri}/messages`, {headers: mailTrapHeaders})
      const emailId = JSON.parse(mailTrapResponse.body)[0].id
      const attachments = yield got(`${mailtrapUri}/messages/${emailId}/attachments`, {headers: mailTrapHeaders})
      const attachment = JSON.parse(attachments.body)[0]
      expect(attachment.filename).to.equal('logo_white.svg')
      expect(attachment.attachment_type).to.equal('attachment')
      expect(attachment.content_type).to.equal('image/svg+xml')
    })

    it('should be able to send raw data as attachments with email', function * () {
      yield mail.raw('Email with raw attachment', function (message) {
        message.to('virk@inbox.mailtrap.io')
        message.from('random@bar.com')
        message.subject('Email with attachment')
        message.attachData('What\'s up', 'hello.txt')
      })
      const mailTrapResponse = yield got(`${mailtrapUri}/messages`, {headers: mailTrapHeaders})
      const emailId = JSON.parse(mailTrapResponse.body)[0].id
      const attachments = yield got(`${mailtrapUri}/messages/${emailId}/attachments`, {headers: mailTrapHeaders})
      const attachment = JSON.parse(attachments.body)[0]
      expect(attachment.filename).to.equal('hello.txt')
      expect(attachment.attachment_type).to.equal('attachment')
      expect(attachment.content_type).to.equal('text/plain')
    })

    it('should be able to send email using a view', function * () {
      yield mail.send('welcome', {}, function (message) {
        message.to('virk@inbox.mailtrap.io')
        message.from('random@bar.com')
        message.subject('Welcome to adonis')
      })
      const mailTrapResponse = yield got(`${mailtrapUri}/messages`, {headers: mailTrapHeaders})
      const emailBody = JSON.parse(mailTrapResponse.body)[0]
      expect(emailBody.subject).to.equal('Welcome to adonis')
      expect(emailBody.html_body.trim()).to.equal('<h2> Welcome to adonis </h2>')
    })

    it('should be able to attach attachments using cid', function * () {
      yield mail.send('paris', {}, function (message) {
        message.to('virk@inbox.mailtrap.io')
        message.from('random@bar.com')
        message.subject('Welcome to adonis')
        message.embed(path.join(__dirname, './assets/paris-880754_960_720.jpg'), 'paris')
      })
      const mailTrapResponse = yield got(`${mailtrapUri}/messages`, {headers: mailTrapHeaders})
      const emailBody = JSON.parse(mailTrapResponse.body)[0]
      expect(emailBody.html_body.trim()).to.equal('<img src="cid:paris" />')
    })
  })
})

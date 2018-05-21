"use strict";
const mongoose = require('mongoose')
const Topic = require('./topic')
const logger = require('../logger')
const websockets = require('../websockets')()
const Scene = require('./scene')

/**
 * Change the Scene title accordingly if the Episode is currently playing
 */
function setName (newName) {
  if (this.started && !this.ended) {
    let scene = new Scene()
    if (scene.title == this.name) {
      scene.title = newName
      scene.save()
    }
  }

  return newName
}

/**
 * @swagger
 * definitions:
 *   Episode:
 *     properties:
 *       number:
 *         type: integer
 *         description: unique identifier in the Episode
 *         required: true
 *       name:
 *         type: string
 *         description: name
 *       date:
 *         type: date
 *         description: when an episode air
 *       started:
 *         type: date
 *         description: time and date when the Episode has started
 *       ended:
 *         type: date
 *         description: time and date when the Episode has ended
 */
let episodeSchema = new mongoose.Schema({
    number: { type: Number, required: true, index: true },
    name: { type: String, set: setName },
    started: { type: Date },
    ended: { type: Date },
    created: { type: Date, required: true },
    modified: { type: Date, required: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref:'Program', required: true, index: true },
    topics: [{ type: mongoose.Schema.Types.ObjectId, ref:'Topic' }]
});
episodeSchema.index({ number: 1, program: 1 }, { unique: true })

let episodeModel = mongoose.model('Episode', episodeSchema)

// when an Episode is removed, delete all its Topics
episodeSchema.post('remove', function(episode) {
  logger.debug("Removed Episode " + episode._id)
  websockets.sockets.emit('episodes.' + episode._id + '.delete', episode)

  Topic
    .find({ episode: episode._id })
    .then(function(topics) {
      topics.forEach(function (topic) {
        topic.remove()
      })
    })
    .catch(function(error) {
        next(error)
    });
})

episodeSchema.pre('save', function(next) {
  this.wasNew = this.isNew

  // stop all others episodes if this one starts playing
  if (this.isModified('started') && this.started && !this.ended) {
    episodeModel
      .find({ ended : null })
      .where('_id').ne(this._id)
      .where('started').ne(null)
      .populate({ 
        path: 'topics',
        populate: {
          path: 'medias',
          model: 'Media'
        } 
      })
      .then(function(results) { // we end all other episodes that are playing
        results.forEach(function (episode) {
          episode.ended = Date.now()
          episode.topics.forEach(function (topic) {
            topic.ended = Date.now()
            topic.medias.forEach(function (media) {
              media.ended = Date.now()
              media.save()
            })
            topic.save()
          })
          episode.save()
        })
        next()
      })
      .catch(function(error) {
        logger.error(error)
      })
  } else {
    next()
  }
})

episodeSchema.post('save', function(episode) {
  if (this.wasNew) {
    websockets.sockets.emit('episodes.add', episode)
  }
  websockets.sockets.emit('episodes.' + episode._id, episode)
})

module.exports = episodeModel
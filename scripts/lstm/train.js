/**
 * scripts/lstm/train.js
 *
 * ES-70: LSTM Ecosystem Collapse Forecaster — Training Script
 *
 * Run from the EcoSim root:
 *   node scripts/lstm/generate.js
 *   node scripts/lstm/train.js
 *
 * Output: scripts/lstm/data/model/model.json + weights.bin
 * Then copy to: public/lstm-model/model.json + weights.bin
 */

const tf   = require('@tensorflow/tfjs')
const fs   = require('fs')
const path = require('path')

// Try to use native backend for speed (install with: npm i @tensorflow/tfjs-node)
try {
  require('@tensorflow/tfjs-node')
  console.log('Using tfjs-node backend (fast)')
} catch {
  console.log('Using JS backend (slower — run: npm i @tensorflow/tfjs-node to speed up)')
}

const DATA_PATH  = path.join(__dirname, 'data/training_data.json')
const MODEL_PATH = path.join(__dirname, 'data/model')

// ── Hyperparameters ───────────────────────────────────────────────────
const EPOCHS      = 40
const BATCH_SIZE  = 64
const VAL_SPLIT   = 0.15
const LSTM_UNITS  = 32
const DENSE_UNITS = 16
const LEARN_RATE  = 0.001

async function train() {
  console.log('Loading training data...')
  const { sequences, labels, seqLen, features } = JSON.parse(
    fs.readFileSync(DATA_PATH, 'utf8')
  )
  const n = sequences.length
  console.log(`  ${n} samples  |  seqLen=${seqLen}  features=${features}`)

  // Build tensors
  const xData = new Float32Array(n * seqLen * features)
  const yData = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    yData[i] = labels[i]
    for (let t = 0; t < seqLen; t++)
      for (let f = 0; f < features; f++)
        xData[i * seqLen * features + t * features + f] = sequences[i][t][f]
  }

  const xs = tf.tensor3d(xData, [n, seqLen, features])
  const ys = tf.tensor1d(yData)

  // ── Model architecture ────────────────────────────────────────
  const model = tf.sequential()

  model.add(tf.layers.lstm({
    units: LSTM_UNITS,
    inputShape: [seqLen, features],
    returnSequences: false,
    dropout: 0.1,
    recurrentDropout: 0.1,
  }))

  model.add(tf.layers.dense({ units: DENSE_UNITS, activation: 'relu' }))
  model.add(tf.layers.dropout({ rate: 0.2 }))
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }))

  model.compile({
    optimizer: tf.train.adam(LEARN_RATE),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  })

  model.summary()

  // ── Training ──────────────────────────────────────────────────
  console.log('\nTraining...')
  let bestValAcc = 0

  await model.fit(xs, ys, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: VAL_SPLIT,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const valAcc = logs.val_acc ?? 0
        if (valAcc > bestValAcc) bestValAcc = valAcc
        console.log(
          `  Epoch ${String(epoch+1).padStart(2)}/${EPOCHS}` +
          `  loss=${logs.loss.toFixed(4)}` +
          `  acc=${(logs.acc*100).toFixed(1)}%` +
          `  val_loss=${logs.val_loss?.toFixed(4) ?? '—'}` +
          `  val_acc=${valAcc ? (valAcc*100).toFixed(1) : '—'}%`
        )
      }
    }
  })

  xs.dispose()
  ys.dispose()

  console.log(`\nBest val_acc: ${(bestValAcc * 100).toFixed(1)}%`)

  // ── Save model in TF.js browser format ───────────────────────
  fs.mkdirSync(MODEL_PATH, { recursive: true })

  await model.save(tf.io.withSaveHandler(async (artifacts) => {
    const modelJSON = {
      modelTopology: artifacts.modelTopology,
      weightsManifest: [{
        paths: ['weights.bin'],
        weights: artifacts.weightSpecs,
      }],
      format: 'layers-model',
      generatedBy: `TensorFlow.js v${tf.version.tfjs}`,
      convertedBy: null,
    }

    fs.writeFileSync(path.join(MODEL_PATH, 'model.json'), JSON.stringify(modelJSON, null, 2))
    fs.writeFileSync(path.join(MODEL_PATH, 'weights.bin'), Buffer.from(artifacts.weightData))

    const jsonSize    = fs.statSync(path.join(MODEL_PATH, 'model.json')).size
    const weightsSize = fs.statSync(path.join(MODEL_PATH, 'weights.bin')).size
    console.log(`\nSaved to ${MODEL_PATH}/`)
    console.log(`  model.json   ${jsonSize} bytes`)
    console.log(`  weights.bin  ${weightsSize} bytes`)
    console.log(`\nNext step: copy both files to EcoSim/public/lstm-model/`)

    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }
  }))
}

train().catch(console.error)
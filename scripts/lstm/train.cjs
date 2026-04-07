/**
 * scripts/lstm/train.cjs
 * Run: node scripts/lstm/train.cjs  (from EcoSim root)
 */

const tf   = require('@tensorflow/tfjs')
const fs   = require('fs')
const path = require('path')

const CWD        = process.cwd()
const DATA_PATH  = path.join(CWD, 'scripts', 'lstm', 'data', 'training_data.json')
const MODEL_PATH = path.join(CWD, 'scripts', 'lstm', 'data', 'model')
const PUBLIC_PATH = path.join(CWD, 'public', 'lstm-model')

try { require('@tensorflow/tfjs-node'); console.log('Using tfjs-node backend (fast)') }
catch { console.log('Using JS backend — this will take ~15 min') }

async function train() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`ERROR: training data not found at ${DATA_PATH}`)
    console.error('Run this first: node scripts/lstm/generate.cjs')
    process.exit(1)
  }

  console.log('Loading data...')
  const { sequences, labels, seqLen, features } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
  const n = sequences.length
  console.log(`  ${n} samples  |  seqLen=${seqLen}  features=${features}`)

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

  const model = tf.sequential()
  model.add(tf.layers.lstm({ units: 32, inputShape: [seqLen, features], returnSequences: false, dropout: 0.1, recurrentDropout: 0.1 }))
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }))
  model.add(tf.layers.dropout({ rate: 0.2 }))
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }))
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'binaryCrossentropy', metrics: ['accuracy'] })
  model.summary()

  console.log('\nTraining...')
  let bestValAcc = 0
  await model.fit(xs, ys, {
    epochs: 40, batchSize: 64, validationSplit: 0.15,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const valAcc = logs.val_acc ?? 0
        if (valAcc > bestValAcc) bestValAcc = valAcc
        console.log(`  Epoch ${String(epoch+1).padStart(2)}/40  loss=${logs.loss.toFixed(4)}  acc=${(logs.acc*100).toFixed(1)}%  val_acc=${valAcc ? (valAcc*100).toFixed(1) : '—'}%`)
      }
    }
  })
  xs.dispose(); ys.dispose()
  console.log(`\nBest val_acc: ${(bestValAcc*100).toFixed(1)}%`)

  // Save model
  fs.mkdirSync(MODEL_PATH, { recursive: true })
  await model.save(tf.io.withSaveHandler(async (artifacts) => {
    const modelJSON = {
      modelTopology: artifacts.modelTopology,
      weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
      format: 'layers-model', generatedBy: `TensorFlow.js`, convertedBy: null,
    }
    fs.writeFileSync(path.join(MODEL_PATH, 'model.json'), JSON.stringify(modelJSON, null, 2))
    fs.writeFileSync(path.join(MODEL_PATH, 'weights.bin'), Buffer.from(artifacts.weightData))
    console.log(`\nSaved to ${MODEL_PATH}`)

    // Auto-copy to public/lstm-model/
    fs.mkdirSync(PUBLIC_PATH, { recursive: true })
    fs.copyFileSync(path.join(MODEL_PATH, 'model.json'),  path.join(PUBLIC_PATH, 'model.json'))
    fs.copyFileSync(path.join(MODEL_PATH, 'weights.bin'), path.join(PUBLIC_PATH, 'weights.bin'))
    console.log(`Auto-copied to ${PUBLIC_PATH}`)
    console.log('\nDone! Refresh the browser and check the console for "[EcoSim] LSTM model loaded"')

    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }
  }))
}

train().catch(console.error)

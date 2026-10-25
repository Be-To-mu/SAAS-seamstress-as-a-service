import { useEffect, useRef, useState, type ChangeEvent } from 'react'

const MAX_REFERENCES = 4
const referenceNames = ['Shape', 'Detail', 'Fabric', 'Colour']

interface Photo {
  id: string
  src: string
}

interface FitStop {
  label: string
  change: string
  image?: string
}

interface FuseResult {
  image: string
  garment: string
  summary: string
  axis: string
  less: FitStop
  more: FitStop
  worn?: string
}

const shared = [
  {
    src: '/market/cap.jpg',
    name: 'Duck cap',
    by: '@billandbrim',
    description: 'A canvas cap with a cream crown, a mustard bill, and two stitched eyes.',
  },
  {
    src: '/market/pyjamas.jpg',
    name: 'Unicorn set',
    by: '@softlaunch',
    description: 'Pink satin pyjamas, unicorns and small gold stars, piped in white.',
  },
  {
    src: '/market/jacket.jpg',
    name: 'Silver jacket',
    by: '@atelier.june',
    description: 'A metallic leather jacket, zip through, with a chest pocket and two patch pockets.',
  },
]

const flow = [
  {
    numeral: 'I',
    name: 'Imagine',
    title: 'Start with an idea.',
    body: 'Start with the idea you already have. Words and images, fused into one garment.',
  },
  {
    numeral: 'II',
    name: 'Scan',
    title: 'Tailored to your body.',
    body: 'A private scan on your phone. The measurements stay yours and become an anonymous mannequin shaped around you. On the phone, that mannequin is you.',
  },
  {
    numeral: 'III',
    name: 'Taste',
    title: 'Fitted to your taste.',
    body: 'One of many options: silhouette, hem, colour, material, and detail. This page is only showing one.',
  },
  {
    numeral: 'IV',
    name: 'Pattern',
    title: 'Cut for your scan.',
    body: 'The design and the measurements become the cutting brief. Pieces, grain, and ease, ready for a maker.',
  },
  {
    numeral: 'V',
    name: 'Choose & make',
    title: 'Choose who makes it.',
    body: 'You design. We translate and connect. They create. The garment arrives at your door.',
  },
  {
    numeral: 'VI',
    name: 'Wear',
    title: 'Wear your creation.',
    body: 'This woman stands in for you. The phone app shows the garment on your own digital twin.',
  },
]

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 896 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('That photo could not be read.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

function readClientStop(raw: unknown): FitStop {
  const row = raw as { label?: unknown; change?: unknown } | null
  const label = typeof row?.label === 'string' && row.label.trim() ? row.label.trim() : 'As made'
  const change = typeof row?.change === 'string' && row.change.trim() ? row.change.trim() : 'The same garment.'
  return { label, change }
}

function shownPortrait(worn: Record<string, string>, key: string): string | undefined {
  if (worn[key]) return worn[key]
  const ready = worn.base || worn.less || worn.more
  if (ready) return ready
  if (key in worn) return ''
  return undefined
}

function chosenPicture(creation: FuseResult, pick: number): { image: string; summary: string; key: string } {
  if (pick === 0 && creation.less.image) return { image: creation.less.image, summary: `${creation.summary} ${creation.less.label}.`, key: 'less' }
  if (pick === 2 && creation.more.image) return { image: creation.more.image, summary: `${creation.summary} ${creation.more.label}.`, key: 'more' }
  return { image: creation.image, summary: creation.summary, key: 'base' }
}

function TasteScreen({ creation, pick }: { creation: FuseResult | null; pick: number }) {
  const image = creation ? chosenPicture(creation, pick).image : undefined
  return (
    <div className="taste-screen">
      {image && <img src={image} alt={creation?.garment ?? ''} />}
    </div>
  )
}

function FitSlider({ creation, pick, onPick }: { creation: FuseResult | null; pick: number; onPick: (pick: number) => void }) {
  const marks = [creation?.less.label ?? 'Less', 'As made', creation?.more.label ?? 'More']
  return (
    <label className="fit-slider">
      <span>{creation?.axis ?? 'Fit'}</span>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={pick}
        aria-valuetext={marks[pick] ?? 'As made'}
        onChange={(event) => onPick(Number(event.target.value))}
      />
      <span className="fit-marks">
        {marks.map((mark, index) => <b className={pick === index ? 'is-on' : ''} key={mark}>{mark}</b>)}
      </span>
    </label>
  )
}

function LiveImagine({ creation, onResult, onBusy }: { creation: FuseResult | null; onResult: (result: FuseResult | null) => void; onBusy: (busy: boolean) => void }) {
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FuseResult | null>(creation)
  const liveImage = useRef('')
  const canFuse = photos.length > 0 || description.trim().length > 0

  function publish(next: FuseResult | null) {
    liveImage.current = next?.image ?? ''
    setResult(next)
    onResult(next)
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    event.target.value = ''
    if (!files?.length) return
    const room = MAX_REFERENCES - photos.length
    if (room <= 0) {
      setError(`You can use up to ${MAX_REFERENCES} reference photos.`)
      return
    }
    setError('')
    try {
      const next: Photo[] = []
      for (let index = 0; index < Math.min(files.length, room); index += 1) {
        const file = files.item(index)
        if (!file) continue
        next.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, src: await shrink(file) })
      }
      setPhotos((current) => [...current, ...next])
      if (files.length > room) setError(`You can use up to ${MAX_REFERENCES} reference photos.`)
    } catch {
      setError('That photo could not be read. Try a JPEG or PNG.')
    }
  }

  async function fuse() {
    if (!canFuse || busy) return
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      const res = await fetch('/api/fuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: photos.map((photo) => photo.src), description: description.trim() }),
      })
      const data = (await res.json()) as FuseResult & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not fuse that idea.')
      const less = readClientStop(data.less)
      const more = readClientStop(data.more)
      const next = { image: data.image, garment: data.garment, summary: data.summary, axis: data.axis || 'Length', less, more }
      publish(next)
      void loadEnds(next, photos.map((photo) => photo.src), description.trim())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not fuse that idea.')
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  async function loadEnds(base: FuseResult, images: string[], note: string) {
    try {
      const varied = await fetch('/api/vary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, description: note, summary: base.summary, less: base.less, more: base.more }),
      })
      const ends = (await varied.json()) as { less?: string | null; more?: string | null }
      if (!varied.ok || liveImage.current !== base.image) return
      publish({
        ...base,
        less: { ...base.less, image: ends.less || undefined },
        more: { ...base.more, image: ends.more || undefined },
      })
    } catch {
      /* The original picture stays in place when an end does not arrive. */
    }
  }

  if (result) {
    return (
      <div className="prompt-screen fuse-done">
        <img className="bleed" src={result.image} alt={result.garment} />
        <p className="swipe-cue">
          <button type="button" onClick={() => publish(null)}>Try another</button>
          <span aria-hidden="true">↓</span> Swipe down for the next step
        </p>
      </div>
    )
  }

  if (busy) {
    return (
      <div className="prompt-screen diffusion-screen" aria-busy="true">
        <p className="screen-kicker">Create / Fusing</p>
        <div className="diffusion" aria-hidden="true">
          <span /><span /><span />
          <p className="diffusion-label">Cloth finding its shape</p>
        </div>
      </div>
    )
  }

  return (
    <div className="prompt-screen">
      <p className="screen-kicker">Create / Try it</p>
      <p className="aim"><span aria-hidden="true">↓</span> Add a photo or describe it here</p>
      <div className="prompt-box">
        <label className="prompt-field">
          <span>Describe what you want</span>
          {photos.length > 0 && (
            <ul className="prompt-chips">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  <img src={photo.src} alt={`${referenceNames[index]} reference`} />
                  <button type="button" aria-label={`Remove reference ${index + 1}`} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} disabled={busy}>×</button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            rows={4}
            maxLength={600}
            value={description}
            placeholder="A long evening coat, with the collar from my reference."
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
        </label>
        {photos.length < MAX_REFERENCES && (
          <label className="attach">
            + Image reference
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={addPhotos} disabled={busy} />
          </label>
        )}
      </div>
      {error && <p className="fuse-error" role="alert">{error}</p>}
      <button type="button" className="fuse-action" disabled={!canFuse || busy} onClick={fuse}>
        <span>{photos.length === 0 ? 'Words only' : `${photos.length} reference${photos.length === 1 ? '' : 's'}`}</span>
        <b>{busy ? 'Fusing…' : 'Fuse my idea →'}</b>
      </button>
    </div>
  )
}

function AppScreen({
  step,
  live = false,
  creation = null,
  pick = 1,
  onResult = () => {},
  onBusy = () => {},
}: {
  step: number
  live?: boolean
  creation?: FuseResult | null
  pick?: number
  onResult?: (result: FuseResult | null) => void
  onBusy?: (busy: boolean) => void
}) {
  return (
    <div className={`stage screen-${step}`}>
      <div className="screen-stage">
        {live && (
          <div className="live-slot" hidden={step !== 0}>
            <LiveImagine creation={creation} onResult={onResult} onBusy={onBusy} />
          </div>
        )}

        {step === 0 && !live && (
          <div className="prompt-screen">
            <p className="screen-kicker">Create / New idea</p>
            <div className="prompt-copy">
              A silver leather jacket, zip through, with a chest pocket and two patch pockets.
              <span className="cursor" />
            </div>
            <div className="reference-row">
              <figure className="solo">
                <img src="/market/jacket.jpg" alt="Silver leather jacket" />
                <figcaption>The jacket</figcaption>
              </figure>
            </div>
            <div className="fuse-action"><span>1 reference</span><b>Fuse my idea →</b></div>
          </div>
        )}

        {step === 1 && (
          <div className="scan-screen">
            <div className="scan-figure" aria-hidden="true">
              <span className="scan-head" />
              <span className="scan-body" />
              <i /><i /><i /><i /><i />
            </div>
            <p className="screen-kicker">Body scan / Live</p>
            <h3>Turn slowly.<br />Keep your phone level.</h3>
            <div className="scan-status"><span>68%</span><i><b /></i><p>Building your private fit profile</p></div>
          </div>
        )}

        {step === 2 && <TasteScreen creation={creation} pick={pick} />}

        {step === 3 && (
          <div className="pattern-screen">
            <div className="pattern-canvas" aria-hidden="true">
              <span className="piece piece-a">A</span>
              <span className="piece piece-b">B</span>
              <span className="piece piece-c">C</span>
              <span className="grain-line">grain →</span>
            </div>
            <div className="pattern-copy">
              <p className="screen-kicker">Pattern / Generated</p>
              <h3>Cut for your<br />scan and fit.</h3>
              <p>12 pattern pieces</p>
              <p>Wool twill · 3.4 m</p>
              <p>The fit you left selected</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="brief-screen">
            <div className="brief-cover">
              <p>YOUR GARMENT / READY</p>
              <h3>Choose your<br />seamstress</h3>
              <img src="https://images.unsplash.com/photo-1699570048416-464809789279?auto=format&fit=crop&w=800&q=88" alt="Seamstress in a contemporary studio" />
            </div>
            <div className="brief-pages">
              <div><span>01</span><p>2D pattern</p><b>Ready</b></div>
              <div><span>02</span><p>Fabric & notions</p><b>Included</b></div>
              <div><span>03</span><p>Making brief</p><b>Complete</b></div>
              <div className="maker-ready"><span>Selected maker · London</span><strong>Send to make</strong><i>↗</i></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [activeStep, setActiveStep] = useState(0)
  const [creation, setCreation] = useState<FuseResult | null>(null)
  const [pick, setPick] = useState(1)
  const [worn, setWorn] = useState<Record<string, string>>({})
  const wornRef = useRef<Record<string, string>>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const dressToken = useRef(0)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    dressToken.current += 1
    const seeded: Record<string, string> = creation?.worn ? { base: creation.worn } : {}
    wornRef.current = seeded
    pendingRef.current = new Set()
    setWorn(seeded)
    setPick(1)
  }, [creation?.image])

  useEffect(() => {
    if (!creation) return
    const token = dressToken.current
    const jobs = [
      { key: 'base', image: creation.image, summary: creation.summary },
      ...(creation.less.image ? [{ key: 'less', image: creation.less.image, summary: `${creation.summary} ${creation.less.label}.` }] : []),
      ...(creation.more.image ? [{ key: 'more', image: creation.more.image, summary: `${creation.summary} ${creation.more.label}.` }] : []),
    ]
    for (const job of jobs) {
      if (job.key in wornRef.current || pendingRef.current.has(job.key)) continue
      pendingRef.current.add(job.key)
      fetch('/api/wear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garment: job.image, summary: job.summary }),
      })
        .then((res) => res.json())
        .then((data: { image?: string }) => {
          if (dressToken.current !== token) return
          wornRef.current = { ...wornRef.current, [job.key]: data.image ?? '' }
          pendingRef.current.delete(job.key)
          setWorn({ ...wornRef.current })
        })
        .catch(() => {
          if (dressToken.current !== token) return
          wornRef.current = { ...wornRef.current, [job.key]: '' }
          pendingRef.current.delete(job.key)
          setWorn({ ...wornRef.current })
        })
    }
  }, [creation])

  useEffect(() => {
    const root = document.documentElement
    if (creation) {
      root.classList.remove('hold-scroll')
      return
    }
    root.classList.add('hold-scroll')
    const limit = () => {
      const step = document.querySelector<HTMLElement>('.flow-step')
      if (step && step.offsetHeight > 80) return Math.max(0, step.offsetTop + step.offsetHeight - window.innerHeight * 0.62)
      const flow = document.querySelector<HTMLElement>('.flow')
      if (!flow) return Number.POSITIVE_INFINITY
      return Math.max(0, flow.offsetTop + flow.offsetHeight - window.innerHeight + 24)
    }
    const clamp = () => {
      const max = limit()
      if (window.scrollY > max) window.scrollTo(0, max)
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) return
      const target = event.target
      if (target instanceof Element && target.closest('.stage')) return
      if (window.scrollY >= limit() - 2) event.preventDefault()
    }
    const onKey = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('textarea, input, button')) return
      if (window.scrollY >= limit() - 2) event.preventDefault()
    }
    let lastTouch = 0
    const onTouchStart = (event: TouchEvent) => { lastTouch = event.touches[0]?.clientY ?? 0 }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? lastTouch
      const goingDown = y < lastTouch - 2
      lastTouch = y
      const target = event.target
      if (target instanceof Element && target.closest('.stage')) return
      if (goingDown && window.scrollY >= limit() - 2) event.preventDefault()
    }
    window.addEventListener('scroll', clamp, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    clamp()
    return () => {
      root.classList.remove('hold-scroll')
      window.removeEventListener('scroll', clamp)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [creation])

  useEffect(() => {
    const pick = () => {
      const band = window.matchMedia('(max-width: 800px)').matches ? window.innerHeight * 0.82 : window.innerHeight * 0.45
      let best = 0
      let bestDist = Number.POSITIVE_INFINITY
      stepRefs.current.forEach((node, index) => {
        if (!node) return
        const rect = node.getBoundingClientRect()
        const dist = Math.abs((rect.top + rect.bottom) / 2 - band)
        if (dist < bestDist) { best = index; bestDist = dist }
      })
      setActiveStep(best)
    }
    pick()
    window.addEventListener('scroll', pick, { passive: true })
    window.addEventListener('resize', pick)
    return () => {
      window.removeEventListener('scroll', pick)
      window.removeEventListener('resize', pick)
    }
  }, [])

  const portraitKey = creation ? chosenPicture(creation, pick).key : ''
  const portrait = portraitKey ? shownPortrait(worn, portraitKey) : undefined

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top">seamstress</a>
        <p>Imagine · fit · make</p>
        <a href="#demo">See the work</a>
      </header>

      <section className="product-hero" id="top">
        <div className="hero-message">
          <p className="eyebrow">Clothes that do not exist yet</p>
          <h1>Imagine it.<br />Wear it.</h1>
          <p>One garment, from the idea you already have.</p>
          <a className="begin" href="#demo">See how it works <span>↓</span></a>
        </div>
        <div className="hero-product">
          <img className="hero-worn" src="/hero-worn.jpg" alt="The same woman, wearing the silver jacket" />
          <div className="floating-reference">
            <span>The design</span>
            <img src="/market/jacket.jpg" alt="The silver jacket" />
          </div>
          <div className="floating-app">
            <AppScreen step={0} />
          </div>
          <p className="hero-caption">Same woman.<br />The design, worn.</p>
        </div>
      </section>

      <section className="problem" id="problem">
        <p className="eyebrow">The problem</p>
        <h2>What if you could turn any idea into a garment made just for you?</h2>
        <p>A photo from your camera roll. A reference you love. Or simply a description of what you imagine. No idea is too ambitious. This is Seamstress.</p>
      </section>

      <section className="flow-intro" id="demo">
        <p className="eyebrow">The work / I–VI</p>
        <h2>One idea.<br />Six clear steps.</h2>
      </section>

      <section className="flow">
        <div className="flow-steps">
          {flow.map((item, index) => (
            <div
              className={`flow-step ${activeStep === index ? 'is-active' : ''}`}
              data-step={index}
              key={item.name}
              ref={node => { stepRefs.current[index] = node }}
            >
              <span>{item.numeral}</span>
              <p className="step-name">{item.name}</p>
              <h2>{item.title}</h2>
              <p className="step-body">{item.body}</p>
              {index === 2 && <FitSlider creation={creation} pick={pick} onPick={setPick} />}
            </div>
          ))}
        </div>
        <div className="flow-visual">
          {activeStep === 5 ? (
            <figure className={portrait ? 'worn-figure is-ready' : 'worn-figure'}>
              {portrait ? (
                <img src={portrait} alt={creation ? `${creation.garment}, worn` : 'The house model wearing the garment'} />
              ) : (
                <div className="worn-wait">{creation ? (portrait === '' ? 'Could not dress her.' : 'Dressing her…') : 'Waiting for an idea'}</div>
              )}
            </figure>
          ) : (
            <AppScreen step={activeStep} live creation={creation} pick={pick} onResult={setCreation} />
          )}
        </div>
      </section>

      <section className="market" id="market">
        <p className="eyebrow">The marketplace</p>
        <h2>Share your<br />design.</h2>
        <p>Let others discover it, make it their own, and have it made. Your creativity can start someone else’s wardrobe.</p>
        <div className="market-row">
          {creation && (
            <article className="market-card is-yours">
              <img src={chosenPicture(creation, pick).image} alt={creation.garment} />
              <h3>{creation.garment}</h3>
              <p>Shared by you</p>
            </article>
          )}
          {shared.map((piece) => (
            <article className="market-card" key={piece.src}>
              <img src={piece.src} alt={piece.name} />
              <h3>{piece.name}</h3>
              <p className="blurb">{piece.description}</p>
              <p className="by">{piece.by}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <p className="eyebrow">Seamstress</p>
        <h2>Imagine it.<br />Wear it.</h2>
        <div className="footer-line"><span>seamstress</span><span>Hackathon prototype · London</span><span>2025</span></div>
      </footer>
    </main>
  )
}

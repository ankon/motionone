import type {
  AnimationControls,
  AnimationOptions,
  Easing,
} from "@motionone/types"
import { isEasingGenerator, isEasingList, defaults } from "@motionone/utils"
import { getEasingFunction } from "./utils/easing"
import { interpolate as createInterpolate } from "./utils/interpolate"

export class Animation implements Omit<AnimationControls, "stop" | "duration"> {
  private resolve?: (value: any) => void

  private reject?: (value: any) => void

  private startTime = 0

  private pauseTime: number | undefined

  private rate = 1

  private tick: (t: number) => void

  private t = 0

  private cancelTimestamp = 0

  private frameRequestId?: number

  playState: AnimationPlayState = "idle"

  constructor(
    output: (v: number) => void,
    keyframes: number[] = [0, 1],
    {
      easing = defaults.easing as Easing,
      duration = defaults.duration,
      delay = defaults.delay,
      endDelay = defaults.endDelay,
      repeat = defaults.repeat,
      offset,
      direction = "normal",
    }: AnimationOptions = {}
  ) {
    const totalDuration = duration * (repeat + 1)

    if (isEasingGenerator(easing)) {
      const custom = easing.createAnimation(keyframes, () => "0", true)
      easing = custom.easing
      if (custom.keyframes !== undefined) keyframes = custom.keyframes
      if (custom.duration !== undefined) duration = custom.duration
    }

    const interpolate = createInterpolate(
      keyframes,
      offset,
      isEasingList(easing)
        ? easing.map(getEasingFunction)
        : getEasingFunction(easing)
    )

    this.tick = (timestamp: number) => {
      if (this.pauseTime) timestamp = this.pauseTime

      let t = (timestamp - this.startTime) * this.rate

      this.t = t

      // Convert to seconds
      t /= 1000

      // Rebase on delay
      t = Math.max(t - delay, 0)

      /**
       * If this animation has finished, set the current time
       * to the total duration.
       */
      if (this.playState === "finished") t = totalDuration

      /**
       * Get the current progress (0-1) of the animation. If t is >
       * than duration we'll get values like 2.5 (midway through the
       * third iteration)
       */
      const progress = t / duration

      // TODO progress += iterationStart

      /**
       * Get the current iteration (0 indexed). For instance the floor of
       * 2.5 is 2.
       */
      let currentIteration = Math.floor(progress)

      /**
       * Get the current progress of the iteration by taking the remainder
       * so 2.5 is 0.5 through iteration 2
       */
      let iterationProgress = progress % 1.0

      if (!iterationProgress && progress >= 1) {
        iterationProgress = 1
      }

      /**
       * If iteration progress is 1 we count that as the end
       * of the previous iteration.
       */
      iterationProgress === 1 && currentIteration--

      /**
       * Reverse progress if we're not running in "normal" direction
       */
      const iterationIsOdd = currentIteration % 2
      if (
        direction === "reverse" ||
        (direction === "alternate" && iterationIsOdd) ||
        (direction === "alternate-reverse" && !iterationIsOdd)
      ) {
        iterationProgress = 1 - iterationProgress
      }

      const latest = interpolate(
        t >= totalDuration ? 1 : Math.min(iterationProgress, 1)
      )

      output(latest)

      const isAnimationFinished =
        this.playState === "finished" || t >= totalDuration + endDelay

      if (isAnimationFinished) {
        this.playState = "finished"
        this.resolve?.(latest)
      } else if (this.playState !== "idle") {
        this.frameRequestId = requestAnimationFrame(this.tick)
      }
    }

    this.play()
  }

  finished = new Promise((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })

  play() {
    const now = performance.now()
    this.playState = "running"

    if (this.pauseTime) {
      this.startTime = now - (this.pauseTime - this.startTime)
    } else if (!this.startTime) {
      this.startTime = now
    }

    this.pauseTime = undefined
    requestAnimationFrame(this.tick)
  }

  pause() {
    this.playState = "paused"
    this.pauseTime = performance.now()
  }

  finish() {
    this.playState = "finished"
    this.tick(0)
  }

  cancel() {
    this.playState = "idle"
    this.tick(this.cancelTimestamp)
    this.reject?.(false)
    if (this.frameRequestId !== undefined) {
      cancelAnimationFrame(this.frameRequestId)
    }
  }

  reverse() {
    this.rate *= -1
  }

  commitStyles() {
    // TODO: The bug now is that this is not called if the animation is finished
    // this should be called regardless
    this.cancelTimestamp = performance.now()
  }

  get currentTime() {
    return this.t
  }

  set currentTime(t: number) {
    if (this.pauseTime || this.rate === 0) {
      this.pauseTime = t
    } else {
      this.startTime = performance.now() - t / this.rate
    }
  }

  get playbackRate() {
    return this.rate
  }

  set playbackRate(rate) {
    this.rate = rate
  }
}
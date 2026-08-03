'use client'

import { createElement, type ElementType, useEffect, useMemo, useRef, useState } from 'react'

interface TextTypeProps {
  className?: string
  showCursor?: boolean
  hideCursorOnComplete?: boolean
  hideCursorWhileTyping?: boolean
  cursorCharacter?: string | React.ReactNode
  cursorBlinkDuration?: number
  cursorClassName?: string
  text: string | string[]
  as?: ElementType
  typingSpeed?: number
  initialDelay?: number
  loop?: boolean
  textColors?: string[]
  variableSpeed?: { min: number; max: number }
  onSentenceComplete?: (sentence: string, index: number) => void
  startOnVisible?: boolean
  reverseMode?: boolean
}

const TextType = ({
  text,
  as: Component = 'div',
  typingSpeed = 50,
  initialDelay = 0,
  loop = false,
  className = '',
  showCursor = true,
  hideCursorOnComplete = false,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  cursorClassName = '',
  cursorBlinkDuration = 0.8,
  textColors = [],
  variableSpeed,
  onSentenceComplete,
  startOnVisible = false,
  reverseMode = false,
  ...props
}: TextTypeProps & React.HTMLAttributes<HTMLElement>) => {
  const [currentCharIndex, setCurrentCharIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(!startOnVisible)
  const containerRef = useRef<HTMLElement>(null)

  const textArray = useMemo(() => (Array.isArray(text) ? text : [text]), [text])

  const segments = useMemo(
    () => textArray.map((segment) => (reverseMode ? segment.split('').reverse().join('') : segment)),
    [reverseMode, textArray]
  )
  const fullText = useMemo(() => segments.join('\n'), [segments])

  const isComplete = currentCharIndex >= fullText.length

  const getCurrentTextColor = () => {
    if (textColors.length === 0) return 'inherit'
    return textColors[0] ?? 'inherit'
  }

  const getTypingDelay = () => {
    if (!variableSpeed) return typingSpeed
    return Math.random() * (variableSpeed.max - variableSpeed.min) + variableSpeed.min
  }

  useEffect(() => {
    if (!startOnVisible || !containerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
          }
        })
      },
      { threshold: 0.1 }
    )

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [startOnVisible])

  useEffect(() => {
    if (!isVisible) return
    if (isComplete) {
      if (onSentenceComplete && textArray.length > 0) {
        const lastIndex = textArray.length - 1
        onSentenceComplete(textArray[lastIndex] ?? '', lastIndex)
      }

      if (!loop) return

      const restartTimeout = setTimeout(() => {
        setCurrentCharIndex(0)
      }, 900)

      return () => clearTimeout(restartTimeout)
    }

    const timeout = setTimeout(
      () => {
        setCurrentCharIndex((prev) => prev + 1)
      },
      currentCharIndex === 0 ? initialDelay : getTypingDelay()
    )

    return () => clearTimeout(timeout)
  }, [
    currentCharIndex,
    fullText.length,
    initialDelay,
    isComplete,
    isVisible,
    loop,
    onSentenceComplete,
    textArray,
    typingSpeed,
    variableSpeed,
  ])

  const shouldHideCursor =
    (hideCursorWhileTyping && !isComplete) ||
    (hideCursorOnComplete && isComplete)

  const renderedSegments = useMemo(() => {
    const nodes: React.ReactNode[] = []
    let remainingChars = currentCharIndex

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? ''
      const typedLength = Math.max(0, Math.min(segment.length, remainingChars))
      const typedSegment = segment.slice(0, typedLength)
      const segmentColor = textColors.length > 0 ? textColors[index % textColors.length] : undefined

      nodes.push(
        <span key={`segment-${index}`} style={segmentColor ? { color: segmentColor } : undefined}>
          {typedSegment}
        </span>
      )

      remainingChars -= typedLength

      if (index < segments.length - 1 && remainingChars > 0) {
        nodes.push(<br key={`break-${index}`} />)
        remainingChars -= 1
      }
    }

    return nodes
  }, [currentCharIndex, segments, textColors])

  return createElement(
    Component,
    {
      ref: containerRef,
      className: `inline-block whitespace-pre-wrap tracking-tight ${className}`,
      ...props,
    },
    <span className="inline" style={{ color: getCurrentTextColor() || 'inherit' }}>
      {renderedSegments}
    </span>,
    showCursor && !shouldHideCursor && (
      <span
        className={`ml-1 inline-block opacity-100 ${cursorClassName}`}
        style={{ animation: `texttype-blink ${cursorBlinkDuration}s ease-in-out infinite` }}
      >
        {cursorCharacter}
      </span>
    )
  )
}

export default TextType
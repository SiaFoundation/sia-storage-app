import { useEffect, useState } from 'react'

export function useInputValue({
  value,
  save,
}: {
  value: string
  save: (value: string) => void
}) {
  const [input, setInput] = useState(value ?? '')

  // Synchronize input state with changes to value
  useEffect(() => {
    setInput(value ?? '')
  }, [value])

  return {
    value: input,
    onChangeText: setInput,
    onBlur: () => {
      save(input)
    },
  }
}

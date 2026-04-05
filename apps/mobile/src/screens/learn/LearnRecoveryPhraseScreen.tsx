import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { LearnScreen, LearnSection, LearnText } from '../../components/LearnScreen'
import type { MenuStackParamList } from '../../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'LearnRecoveryPhrase'>

export function LearnRecoveryPhraseScreen(_props: Props) {
  return (
    <LearnScreen>
      <LearnSection title="Your Recovery Phrase">
        <LearnText>
          When you set up this app, you were given 12 words. These words are your recovery phrase -
          the key to your files. From these words, your local app derives the private key by which
          you lock and unlock your files and the public key by which you can be indentified by an
          indexer (storage coordinator).
        </LearnText>
      </LearnSection>

      <LearnSection title="Why it matters">
        <LearnText>
          Your recovery phrase encrypts your files so only you can see them. It proves who you are
          and unlocks your data - without anyone else ever being able to access it.
        </LearnText>
      </LearnSection>

      <LearnSection title="Your files, anywhere">
        <LearnText>
          Enter your recovery phrase on any device to access your library. Use it on multiple
          devices at once and they'll stay in sync automatically. If you ever lose a device, your
          files are safe - just enter your phrase on a new one.
        </LearnText>
      </LearnSection>

      <LearnSection title="Keep it safe">
        <LearnText>
          Write your recovery phrase down on paper and store it somewhere secure - like you would a
          passport or important document. Consider keeping a second copy in a different location.
        </LearnText>
        <LearnText>
          {'\n'}Your recovery phrase isn't stored anywhere except with you. That's what makes your
          files truly private - but it also means no one can recover it for you if it's lost.
        </LearnText>
      </LearnSection>

      <LearnSection title="Keep it secret">
        <LearnText>
          Anyone with your recovery phrase can access your files. Never share it, and be wary of
          anyone who asks for it. No one from Sia will ever ask you for your recovery phrase.
        </LearnText>
      </LearnSection>
    </LearnScreen>
  )
}

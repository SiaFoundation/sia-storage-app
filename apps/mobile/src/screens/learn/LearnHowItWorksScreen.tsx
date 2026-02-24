import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  LearnScreen,
  LearnSection,
  LearnText,
} from '../../components/LearnScreen'
import type { MenuStackParamList } from '../../stacks/types'

type Props = NativeStackScreenProps<MenuStackParamList, 'LearnHowItWorks'>

export function LearnHowItWorksScreen(_props: Props) {
  return (
    <LearnScreen>
      <LearnSection title="Encrypted and split on your device">
        <LearnText>
          Before your files leave your phone, they're encrypted and split into
          30 pieces. Encryption scrambles your data so only your recovery phrase
          can unlock it. Splitting means no single piece contains enough
          information to reconstruct your file.
        </LearnText>
      </LearnSection>

      <LearnSection title="Spread across the world">
        <LearnText>
          Those 30 pieces are distributed to independent computers (called
          hosts) around the world. Each host stores just one piece of your
          encrypted data - they can't see what's inside, and they don't have
          enough to reconstruct it.
        </LearnText>
      </LearnSection>

      <LearnSection title="Built to last">
        <LearnText>
          Of those 30 pieces, you only need 10 to get your file back. That means
          even if 20 hosts go offline, your files remain safe and accessible.
          Your data doesn't depend on any single computer or company.
        </LearnText>
      </LearnSection>

      <LearnSection title="Your indexer">
        <LearnText>
          The indexer coordinates everything - it knows where your pieces are
          stored and helps your devices sync. But your data never passes through
          it. You connect directly to hosts, and the indexer only tracks where
          things are - never what they contain.
        </LearnText>
      </LearnSection>
    </LearnScreen>
  )
}

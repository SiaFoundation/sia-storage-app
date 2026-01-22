import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MenuStackParamList } from '../../stacks/types'
import {
  LearnScreen,
  LearnSection,
  LearnText,
} from '../../components/LearnScreen'

type Props = NativeStackScreenProps<MenuStackParamList, 'LearnIndexer'>

export function LearnIndexerScreen(_props: Props) {
  return (
    <LearnScreen>
      <LearnSection title="Your gateway to the network">
        <LearnText>
          An indexer is a service that connects you to the Sia storage network.
          It finds hosts, tracks where your file pieces are stored, and keeps
          everything running - so you don't have to.
        </LearnText>
      </LearnSection>

      <LearnSection title="What it does for you">
        <LearnText>
          When you upload, your indexer tells your device where to send each
          encrypted piece. When you download, it tells your device where to
          retrieve them. Your data flows directly between you and the hosts -
          the indexer just coordinates and keeps your devices in sync.
        </LearnText>
      </LearnSection>

      <LearnSection title="What it can't do">
        <LearnText>
          Your indexer never sees your files - and never even touches them. Your
          encrypted pieces are sent directly from your device to hosts around
          the world. The indexer only knows where things are stored, not what
          they contain.
        </LearnText>
      </LearnSection>

      <LearnSection title="Who runs indexers">
        <LearnText>
          Sia Storage runs an indexer, which you may be using now. The software
          is open source though - anyone can run one, and we hope they do. More
          indexers means more choice for you and a stronger network for
          everyone.
        </LearnText>
      </LearnSection>
    </LearnScreen>
  )
}

import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { Text, StyleSheet, Linking } from 'react-native'
import { type MenuStackParamList } from '../../stacks/types'
import { LearnScreen, LearnSection, LearnText } from '../../components/LearnScreen'
import { palette } from '../../styles/colors'

type Props = NativeStackScreenProps<MenuStackParamList, 'LearnSiaNetwork'>

export function LearnSiaNetworkScreen(_props: Props) {
  return (
    <LearnScreen>
      <LearnSection title="A different kind of cloud">
        <LearnText>
          Sia is a decentralized storage network. Instead of keeping your files
          on servers owned by one company, Sia spreads them across thousands of
          independent computers around the world. No single organization
          controls your data.
        </LearnText>
      </LearnSection>

      <LearnSection title="Powered by people">
        <LearnText>
          Anyone can offer their unused hard drive space to the network. These
          storage providers (called hosts) compete to offer reliable service at
          fair prices. This creates a marketplace that keeps costs down while
          maintaining quality.
        </LearnText>
      </LearnSection>

      <LearnSection title="Privacy by design">
        <LearnText>
          Your files are encrypted and split into pieces before they ever leave
          your device. Hosts store encrypted pieces - they can't see what you've
          stored, and no single host has enough to reconstruct anything.
        </LearnText>
      </LearnSection>

      <LearnSection title="Complexity handled for you">
        <LearnText>
          Behind the scenes, Sia uses blockchain technology to handle payments
          and contracts with hosts automatically. But don't worry - there are no
          wallets to manage or tokens to buy. Just store your files and the
          network takes care of the rest.
        </LearnText>
      </LearnSection>

      <LearnSection title="Want to go deeper?">
        <LearnText>
          Curious to learn more - or even run your own host?{' '}
          <Text
            onPress={() => Linking.openURL('https://sia.tech')}
            style={styles.link}
          >
            Visit sia.tech
          </Text>
        </LearnText>
      </LearnSection>
    </LearnScreen>
  )
}

const styles = StyleSheet.create({
  link: {
    color: palette.green[500],
    textDecorationLine: 'underline',
  },
})

import { HeroJourney } from "@/components/home/HeroJourney";
import { CampaignGrid } from "@/components/home/CampaignGrid";
import { Ending, FoundingQuote, FourSteps, HomeIntro } from "@/components/home/Editorial";
import { JuryQuestions } from "@/components/home/JuryQuestions";
import { ZKExplainer } from "@/components/home/ZKExplainer";
import { StellarOnChain } from "@/components/home/StellarOnChain";
import { WhyHarvest } from "@/components/home/WhyHarvest";
import { CooperativesSection } from "@/components/home/CooperativesSection";
import { SuccessStories } from "@/components/home/SuccessStories";
import { Testimonials } from "@/components/home/Testimonials";
import { FAQ } from "@/components/home/FAQ";

export default function Home() {
  return (
    <div>
      <HeroJourney />
      <HomeIntro />
      <CampaignGrid />
      <FoundingQuote />
      <FourSteps />
      <JuryQuestions />
      <ZKExplainer />
      <StellarOnChain />
      <WhyHarvest />
      <CooperativesSection />
      <SuccessStories />
      <Testimonials />
      <FAQ />
      <Ending />
    </div>
  );
}

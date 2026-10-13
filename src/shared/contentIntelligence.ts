export type ContentIntelligenceDecisionMode='auto'|'manual';
export type ContentIntelligencePacingMode='slow'|'medium'|'fast';
export type ContentIntelligenceRepeatMode='off'|'adaptive'|'each-song';
export interface ContentIntelligenceConfig {
  enabled: boolean;
  decisionMode: ContentIntelligenceDecisionMode;
  pacingMode: ContentIntelligencePacingMode;
  maxSessionSeconds: number;
  feedSampling: boolean;
  creatorExploration: boolean;
  allowRepeat: boolean;
  maxPerSongSeconds: number;
  streamingWarmupMaxSeconds: number;
  streamingRandomWarmupTrack: boolean;
  streamingVolumeVariation: boolean;
  streamingRepeatMode: ContentIntelligenceRepeatMode;
  repeatAllGroupCycles: number;
  groupRepeatCounts: number[];
  streamingFavoriteAllowed: boolean;
  streamingFollowAllowed: boolean;
  socialLikeAllowed: boolean;
  socialFollowAllowed: boolean;
  socialCommentAllowed: boolean;
  socialCommentDraft: string;
  /** Legacy persisted field; automatic public actions are not enabled by Content Intelligence. */
  suggestedActions: boolean;
  interestKeywords: string;
}
export const DEFAULT_CONTENT_INTELLIGENCE:ContentIntelligenceConfig={
  enabled:false,
  decisionMode:'auto',
  pacingMode:'medium',
  maxSessionSeconds:200,
  feedSampling:true,
  creatorExploration:true,
  allowRepeat:true,
  maxPerSongSeconds:120,
  streamingWarmupMaxSeconds:20,
  streamingRandomWarmupTrack:true,
  streamingVolumeVariation:true,
  streamingRepeatMode:'adaptive',
  repeatAllGroupCycles:1,
  groupRepeatCounts:[],
  streamingFavoriteAllowed:false,
  streamingFollowAllowed:false,
  socialLikeAllowed:false,
  socialFollowAllowed:false,
  socialCommentAllowed:false,
  socialCommentDraft:'',
  suggestedActions:false,
  interestKeywords:'',
};

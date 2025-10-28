export interface Scene {
  sceneDescription: string;
  searchQuery: string;
  duration: number; // in seconds
  imageUrl: string;
}

export interface SavedProject {
  id: number;
  topic: string;
  scenes: Scene[];
  audioData: string; // base64 encoded audio
  title: string;
  hashtags: string;
}
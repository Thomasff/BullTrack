import { pruneRoundPhotos } from '../src/application/services/shareService';

const mockPhotoNames: { current: string[] } = { current: [] };
const mockDeleteRoundPhotos = jest.fn(async (_names: string[]) => 0);

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));
jest.mock('../src/native-bridge/bulltrack/bullTrackNative', () => ({
  bullTrackNativeBridge: {
    listRoundPhotos: async () => ({ directory: '', names: mockPhotoNames.current }),
    deleteRoundPhotos: (names: string[]) => mockDeleteRoundPhotos(names),
  },
}));
jest.mock('../src/application/services/historyRepository', () => ({
  getRoundBests: jest.fn(),
  // Games started at 1-6 were saved; 7 was left before the end, 8 is not saved yet.
  listMatchStarts: async () => [1, 2, 3, 4, 5, 6],
}));

test('keeps the five newest saved matches and the newest game', async () => {
  mockPhotoNames.current = [1, 2, 3, 4, 5, 6, 7, 8].map(start => `${start}-1-0-full.jpg`);
  await pruneRoundPhotos();
  expect(mockDeleteRoundPhotos).toHaveBeenCalledWith(['1-1-0-full.jpg', '7-1-0-full.jpg']);
});

import { BusinessSettingsModel, type BusinessSettingsHydrated } from './settings.model';

export const settingsRepository = {
  async getOrCreate(): Promise<BusinessSettingsHydrated> {
    const settings = await BusinessSettingsModel.findOneAndUpdate(
      {},
      { $setOnInsert: {} },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    return settings as BusinessSettingsHydrated;
  },
};

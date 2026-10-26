// A room is reached by its link alone, so the token in it is the key: 128 random bits.
export const TOKEN = /^[0-9a-f]{32}$/;

export type RoomInfo = { token: string; name: string; creator: string; created: number };

import mongoose from "mongoose";
const schema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, value: { type: Number, default: 0 } }, { timestamps: true });
export const Sequence = mongoose.model("Sequence", schema);

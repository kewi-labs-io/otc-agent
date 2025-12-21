"use client";

import Avatar from "boring-avatars";

interface WalletAvatarProps {
  address: string;
  size?: number;
  className?: string;
}

// Brand-inspired color palette for consistent, beautiful avatars
const AVATAR_COLORS = [
  "#6366f1", // Indigo - brand primary
  "#8b5cf6", // Violet
  "#a855f7", // Purple
  "#d946ef", // Fuchsia
  "#ec4899", // Pink
];

export function WalletAvatar({
  address,
  size = 32,
  className,
}: WalletAvatarProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
      }}
    >
      <Avatar
        size={size}
        name={address}
        variant="beam"
        colors={AVATAR_COLORS}
      />
    </div>
  );
}

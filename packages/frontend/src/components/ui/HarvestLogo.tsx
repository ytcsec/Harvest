import React from "react";

interface HarvestLogoProps {
  className?: string;
  variant?: "full" | "dark" | "mono";
  bg?: string;
  rotate180?: boolean;
}

export function HarvestLogo({
  className = "w-10 h-10",
  variant = "full",
  bg = "transparent",
  rotate180 = true,
}: HarvestLogoProps) {
  const isDark = variant === "dark";
  const isMono = variant === "mono";

  const strokeColor = isDark ? "#E5C158" : "#244E2C";
  const circleColor = isDark ? "#FFFFFF" : "#244E2C";
  const leafFill = isMono ? "#244E2C" : isDark ? "#CCA030" : "#D6A32F";
  const stemColor = isDark ? "#E5C158" : "#244E2C";

  return (
    <svg
      viewBox="0 0 320 320"
      className={className}
      aria-label="HARVEST Field Mark"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* İç daire zemin dolgusu */}
      {bg !== "transparent" && (
        <circle cx="160" cy="160" r="150" fill={bg} />
      )}

      {/* 01 Solid Outer Seal */}
      <circle
        cx="160"
        cy="160"
        r="150"
        fill="none"
        stroke={circleColor}
        strokeWidth="6.5"
      />

      {/* 02 Dotted Inner Seal */}
      <circle
        cx="160"
        cy="160"
        r="130"
        fill="none"
        stroke={circleColor}
        strokeWidth="3.2"
        strokeDasharray="2.5 7.5"
        strokeLinecap="round"
      />

      {/* 03 11 Grain Forms + Stem (180 derece çevrilmiş / doğru buğday başağı oryantasyonu) */}
      <g
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
        transform={rotate180 ? "rotate(180 160 160)" : undefined}
      >
        {/* Stem (Sap) */}
        <line
          x1="160"
          y1="85"
          x2="160"
          y2="265"
          stroke={stemColor}
          strokeWidth="4.5"
        />

        {/* 1. Apex Grain */}
        <path
          d="M 160 52 
             C 148 68, 148 84, 160 100 
             C 172 84, 172 68, 160 52 Z"
          fill={leafFill}
        />

        {/* 2. Çift */}
        <path
          d="M 160 100 
             C 138 90, 122 100, 116 118 
             C 134 122, 150 115, 160 102 Z"
          fill={leafFill}
        />
        <path
          d="M 160 100 
             C 182 90, 198 100, 204 118 
             C 186 122, 170 115, 160 102 Z"
          fill={leafFill}
        />

        {/* 3. Çift */}
        <path
          d="M 160 128 
             C 136 118, 118 128, 112 148 
             C 132 152, 148 144, 160 130 Z"
          fill={leafFill}
        />
        <path
          d="M 160 128 
             C 184 118, 202 128, 208 148 
             C 188 152, 172 144, 160 130 Z"
          fill={leafFill}
        />

        {/* 4. Çift */}
        <path
          d="M 160 158 
             C 134 148, 116 158, 110 178 
             C 130 182, 148 174, 160 160 Z"
          fill={leafFill}
        />
        <path
          d="M 160 158 
             C 186 148, 204 158, 210 178 
             C 190 182, 172 174, 160 160 Z"
          fill={leafFill}
        />

        {/* 5. Çift */}
        <path
          d="M 160 188 
             C 136 178, 120 188, 114 206 
             C 134 210, 148 202, 160 190 Z"
          fill={leafFill}
        />
        <path
          d="M 160 188 
             C 184 178, 200 188, 206 206 
             C 186 210, 172 202, 160 190 Z"
          fill={leafFill}
        />

        {/* 6. Çift */}
        <path
          d="M 160 216 
             C 142 208, 130 216, 126 230 
             C 142 233, 152 227, 160 218 Z"
          fill={leafFill}
        />
        <path
          d="M 160 216 
             C 178 208, 190 216, 194 230 
             C 178 233, 168 227, 160 218 Z"
          fill={leafFill}
        />
      </g>
    </svg>
  );
}

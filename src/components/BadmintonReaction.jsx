import { useEffect, useState } from 'react';

export default function BadmintonReaction({ status }) {
  const [visible, setVisible] = useState(true);
  const smash = status === 'available';

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className={`badminton-reaction ${smash ? 'reaction-smash' : 'reaction-miss'}`} aria-hidden="true">
      <svg viewBox="0 0 360 180" focusable="false">
        <path className="reaction-court" d="M20 155H340 M230 50V155 M230 65H335 M250 65V155 M270 65V155 M290 65V155 M310 65V155 M230 85H335 M230 105H335 M230 125H335" />
        <ellipse className="reaction-shadow" cx="110" cy="155" rx="33" ry="5" />
        <g className="reaction-player">
          <circle className="reaction-head" cx="110" cy="65" r="13" />
          <path className="reaction-shirt" d="M98 82L122 82L130 114H92Z" />
          <g className="reaction-limbs">
            <path d="M100 115L91 136L80 150 M120 115L133 132L140 150 M99 88L78 103L69 89" />
            <g className="reaction-arm">
              <path d="M121 88L140 69L144 48" />
              <path className="reaction-racket" d="M144 48L149 31" />
              <ellipse className="reaction-racket" cx="154" cy="19" rx="10" ry="15" transform="rotate(22 154 19)" />
              <path className="reaction-strings" d="M150 9L158 29 M146 17L161 22 M148 12L162 17 M145 22L158 27" />
            </g>
          </g>
        </g>
        <g className="reaction-shuttle">
          <path className="reaction-feathers" d="M-5 -3L-17 -13L-20 1L-7 5Z M-17 -13L-7 2 M-20 1L-7 2" />
          <circle cx="-3" cy="2" r="5" fill="#fff" stroke="#0f2a4a" strokeWidth="2" />
        </g>
        <g className="reaction-impact">
          <path d="M159 13L168 5 M165 23H178 M160 31L169 40" />
        </g>
        <text className="reaction-caption" x="25" y="27">{smash ? 'Smash! See you on court.' : 'Missed this one. See you next time!'}</text>
      </svg>
    </div>
  );
}

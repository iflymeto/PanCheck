package model

import "time"

// InvalidLink 失效链接表
type InvalidLink struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	Link               string    `gorm:"type:varchar(500);uniqueIndex;not null" json:"link"`
	Platform           Platform  `gorm:"type:varchar(20);not null;index" json:"platform"`
	FailureReason      string    `gorm:"type:text" json:"failure_reason"`
	CheckDuration      *int64    `gorm:"type:bigint" json:"check_duration"`
	IsRateLimited      bool      `gorm:"type:boolean;default:false;index" json:"is_rate_limited"`
	IsPasswordProtected bool     `gorm:"type:boolean;default:false;index" json:"is_password_protected"`
	SubmissionID       *uint     `gorm:"index" json:"submission_id"`
	CreatedAt          time.Time `gorm:"not null" json:"created_at"`
}

// TableName 指定表名
func (InvalidLink) TableName() string {
	return "invalid_links"
}
